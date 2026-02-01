#!/bin/bash
# ==========================================
# NewAPI Model Check - 一键部署脚本
# ==========================================
# 项目地址: https://github.com/chxcodepro/newapi-model-check
#
# 用法: ./deploy.sh [选项]
#
# 选项:
#   --local       全本地模式（PostgreSQL + Redis 本地运行）
#   --cloud-db    云数据库模式（仅启动 Redis）
#   --cloud-redis 云 Redis 模式（仅启动 PostgreSQL）
#   --cloud       全云端模式（不启动数据库服务）
#   --help        显示帮助信息
#
# 示例:
#   ./deploy.sh --local        # 最简单，全部本地运行
#   ./deploy.sh --cloud-db     # 使用 Supabase/Neon/TiDB 等云数据库
#   ./deploy.sh --cloud        # 数据库和 Redis 都用云端

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# 打印带颜色的消息
info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# 全局变量：存储检测到的服务信息
DETECTED_REDIS_URL=""
DETECTED_POSTGRES_URL=""
DETECTED_POSTGRES_CONTAINER=""  # 检测到的外部 PostgreSQL 容器名
DETECTED_POSTGRES_USER=""       # 检测到的外部 PostgreSQL 用户名
DETECTED_POSTGRES_DB=""         # 检测到的外部 PostgreSQL 数据库名
USE_EXTERNAL_REDIS=false
USE_EXTERNAL_POSTGRES=false
REDIS_PORT_TO_USE=6379
POSTGRES_PORT_TO_USE=5432
EXTERNAL_NETWORKS=()

# 获取 Docker 宿主机地址（从容器内访问宿主机）
get_docker_host() {
    # Linux: 使用 docker0 网桥网关地址
    local docker_gateway=$(docker network inspect bridge --format '{{range .IPAM.Config}}{{.Gateway}}{{end}}' 2>/dev/null || true)
    if [ -n "$docker_gateway" ]; then
        echo "$docker_gateway"
    else
        # 回退到常见的 Docker 网桥地址
        echo "172.17.0.1"
    fi
}

# 获取容器的宿主机映射端口
get_container_host_port() {
    local container_name=$1
    local container_port=$2
    # 获取映射到宿主机的端口，格式如 "0.0.0.0:6379->6379/tcp"
    local port_mapping=$(docker port "$container_name" "$container_port" 2>/dev/null | head -n 1 || true)
    if [ -n "$port_mapping" ]; then
        # 提取端口号
        echo "$port_mapping" | sed 's/.*://'
    fi
}

# 生成 docker-compose.override.yml 配置外部网络
generate_compose_override() {
    # 如果没有外部网络需要连接，删除 override 文件（如果存在）
    if [ ${#EXTERNAL_NETWORKS[@]} -eq 0 ]; then
        rm -f docker-compose.override.yml
        return
    fi

    info "生成 docker-compose.override.yml 配置外部网络..."

    # 去重
    local unique_networks=($(echo "${EXTERNAL_NETWORKS[@]}" | tr ' ' '\n' | sort -u | tr '\n' ' '))

    # 开始写入文件
    cat > docker-compose.override.yml << 'HEADER'
# 自动生成 - 用于连接外部 Docker 网络
# 请勿手动编辑，重新运行 deploy.sh 会覆盖此文件

services:
  app:
    networks:
      - newapi-network
HEADER

    # 添加外部网络引用
    for net in "${unique_networks[@]}"; do
        echo "      - ${net}" >> docker-compose.override.yml
    done

    # 添加 networks 定义
    echo "" >> docker-compose.override.yml
    echo "networks:" >> docker-compose.override.yml
    for net in "${unique_networks[@]}"; do
        echo "  ${net}:" >> docker-compose.override.yml
        echo "    external: true" >> docker-compose.override.yml
    done

    success "已生成 docker-compose.override.yml"
}

# 检查端口是否被占用
check_port_in_use() {
    local port=$1
    if command -v ss &> /dev/null; then
        ss -tuln 2>/dev/null | grep -q ":${port} " && return 0
    elif command -v netstat &> /dev/null; then
        netstat -tuln 2>/dev/null | grep -q ":${port} " && return 0
    elif command -v lsof &> /dev/null; then
        lsof -i :${port} &>/dev/null && return 0
    fi
    return 1
}

# 查找可用端口
find_available_port() {
    local start_port=$1
    local port=$start_port
    while check_port_in_use $port; do
        port=$((port + 1))
        if [ $port -gt $((start_port + 100)) ]; then
            echo $start_port
            return 1
        fi
    done
    echo $port
}

# 检测 Docker 中运行的 Redis 容器
detect_docker_redis() {
    info "检测 Docker Redis 服务..."

    # 查找正在运行的 Redis 容器（排除本项目的容器）
    local redis_containers=$(docker ps --format '{{.Names}}:{{.Ports}}' 2>/dev/null | grep -i redis | grep -v "newapi-redis" || true)

    if [ -n "$redis_containers" ]; then
        # 解析第一个找到的 Redis 容器
        local container_info=$(echo "$redis_containers" | head -n 1)
        local container_name=$(echo "$container_info" | cut -d: -f1)

        # 尝试获取 Redis 容器的网络信息
        local redis_ip=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$container_name" 2>/dev/null || true)

        if [ -n "$redis_ip" ]; then
            success "检测到 Docker Redis 容器: $container_name (IP: $redis_ip)"

            # 检查是否可以连接
            if docker exec "$container_name" redis-cli ping &>/dev/null; then
                echo ""
                read -p "是否复用此 Redis? (Y/n): " reuse_redis
                if [[ ! "$reuse_redis" =~ ^[Nn]$ ]]; then
                    # 检查是否有端口映射到宿主机
                    local host_port=$(get_container_host_port "$container_name" "6379")

                    if [ -n "$host_port" ]; then
                        # 有端口映射，使用宿主机地址
                        local docker_host=$(get_docker_host)
                        DETECTED_REDIS_URL="redis://${docker_host}:${host_port}"
                        success "可复用 Redis: ${docker_host}:${host_port}"
                    else
                        # 无端口映射，使用容器名 + 外部网络
                        local redis_network=$(docker inspect -f '{{range $key, $val := .NetworkSettings.Networks}}{{$key}}{{end}}' "$container_name" 2>/dev/null | head -n 1)
                        DETECTED_REDIS_URL="redis://${container_name}:6379"
                        EXTERNAL_NETWORKS+=("$redis_network")
                        success "可复用 Redis: ${container_name}:6379 (网络: $redis_network)"
                    fi
                    USE_EXTERNAL_REDIS=true
                    return 0
                else
                    info "跳过复用，将启动新的 Redis 容器"
                fi
            fi
        fi
    fi

    # 检查端口 6379 是否被占用（非 Docker 方式运行的 Redis）
    if check_port_in_use 6379; then
        # 尝试连接本地 Redis
        if command -v redis-cli &>/dev/null && redis-cli ping &>/dev/null; then
            local docker_host=$(get_docker_host)
            echo ""
            read -p "检测到本地 Redis 服务，是否复用? (Y/n): " reuse_redis
            if [[ ! "$reuse_redis" =~ ^[Nn]$ ]]; then
                DETECTED_REDIS_URL="redis://${docker_host}:6379"
                USE_EXTERNAL_REDIS=true
                success "将使用本地 Redis: ${docker_host}:6379"
                return 0
            else
                info "跳过复用，将启动新的 Redis 容器"
            fi
        else
            warn "端口 6379 被占用但无法连接，将使用其他端口"
        fi
        REDIS_PORT_TO_USE=$(find_available_port 6380)
        if [ "$REDIS_PORT_TO_USE" != "6379" ]; then
            warn "Redis 将使用端口: $REDIS_PORT_TO_USE"
        fi
    fi

    info "未检测到可复用的 Redis，将启动新容器"
    return 1
}

# 检测 Docker 中运行的 PostgreSQL 容器
detect_docker_postgres() {
    info "检测 Docker PostgreSQL 服务..."

    # 查找正在运行的 PostgreSQL 容器（排除本项目的容器）
    local postgres_containers=$(docker ps --format '{{.Names}}:{{.Ports}}' 2>/dev/null | grep -i postgres | grep -v "newapi-postgres" || true)

    if [ -n "$postgres_containers" ]; then
        # 解析第一个找到的 PostgreSQL 容器
        local container_info=$(echo "$postgres_containers" | head -n 1)
        local container_name=$(echo "$container_info" | cut -d: -f1)

        # 尝试获取容器的网络信息
        local postgres_ip=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$container_name" 2>/dev/null || true)

        if [ -n "$postgres_ip" ]; then
            success "检测到 Docker PostgreSQL 容器: $container_name (IP: $postgres_ip)"

            # 尝试从容器环境变量获取连接信息
            local pg_user=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$container_name" 2>/dev/null | grep -E '^POSTGRES_USER=' | cut -d= -f2 || true)
            local pg_password=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$container_name" 2>/dev/null | grep -E '^POSTGRES_PASSWORD=' | cut -d= -f2 || true)
            local pg_db=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$container_name" 2>/dev/null | grep -E '^POSTGRES_DB=' | cut -d= -f2 || true)

            # 使用默认值
            pg_user=${pg_user:-postgres}
            pg_db=${pg_db:-postgres}

            if [ -n "$pg_password" ]; then
                success "自动识别 PostgreSQL 连接信息"
                info "  用户: $pg_user, 数据库: $pg_db"

                # 验证连接
                if docker exec "$container_name" psql -U "$pg_user" -d "$pg_db" -c "SELECT 1" &>/dev/null; then
                    echo ""
                    read -p "是否复用此 PostgreSQL? (Y/n): " reuse_pg
                    if [[ ! "$reuse_pg" =~ ^[Nn]$ ]]; then
                        # 检查是否有端口映射到宿主机
                        local host_port=$(get_container_host_port "$container_name" "5432")

                        if [ -n "$host_port" ]; then
                            # 有端口映射，使用宿主机地址
                            local docker_host=$(get_docker_host)
                            DETECTED_POSTGRES_URL="postgresql://${pg_user}:${pg_password}@${docker_host}:${host_port}/${pg_db}"
                            success "可复用 PostgreSQL: ${docker_host}:${host_port}"
                        else
                            # 无端口映射，使用容器名 + 外部网络
                            local postgres_network=$(docker inspect -f '{{range $key, $val := .NetworkSettings.Networks}}{{$key}}{{end}}' "$container_name" 2>/dev/null | head -n 1)
                            DETECTED_POSTGRES_URL="postgresql://${pg_user}:${pg_password}@${container_name}:5432/${pg_db}"
                            EXTERNAL_NETWORKS+=("$postgres_network")
                            success "可复用 PostgreSQL: ${container_name}:5432 (网络: $postgres_network)"
                        fi
                        USE_EXTERNAL_POSTGRES=true
                        DETECTED_POSTGRES_CONTAINER="$container_name"
                        DETECTED_POSTGRES_USER="$pg_user"
                        DETECTED_POSTGRES_DB="$pg_db"
                        return 0
                    else
                        info "跳过复用，将启动新的 PostgreSQL 容器"
                        return 1
                    fi
                else
                    warn "连接验证失败，可能需要手动配置"
                fi
            else
                warn "无法获取 PostgreSQL 密码，需要手动输入"
            fi

            # 如果自动识别失败，回退到手动输入
            echo ""
            read -p "是否手动输入连接信息? (y/N): " reuse_pg
            if [[ "$reuse_pg" =~ ^[Yy]$ ]]; then
                local host_port=$(get_container_host_port "$container_name" "5432")
                if [ -n "$host_port" ]; then
                    local docker_host=$(get_docker_host)
                    echo "请输入 PostgreSQL 连接字符串"
                    echo "格式: postgresql://用户名:密码@${docker_host}:${host_port}/数据库名"
                else
                    echo "请输入 PostgreSQL 连接字符串"
                    echo "格式: postgresql://用户名:密码@${container_name}:5432/数据库名"
                fi
                read -p "连接字符串: " pg_url
                if [ -n "$pg_url" ]; then
                    DETECTED_POSTGRES_URL="$pg_url"
                    USE_EXTERNAL_POSTGRES=true
                    DETECTED_POSTGRES_CONTAINER="$container_name"
                    DETECTED_POSTGRES_USER="$pg_user"
                    DETECTED_POSTGRES_DB="$pg_db"
                    # 如果没有端口映射，添加外部网络
                    if [ -z "$host_port" ]; then
                        local postgres_network=$(docker inspect -f '{{range $key, $val := .NetworkSettings.Networks}}{{$key}}{{end}}' "$container_name" 2>/dev/null | head -n 1)
                        EXTERNAL_NETWORKS+=("$postgres_network")
                    fi
                    success "将复用 PostgreSQL"
                    return 0
                fi
            fi
        fi
    fi

    # 检查端口 5432 是否被占用（非 Docker 方式运行的 PostgreSQL）
    if check_port_in_use 5432; then
        local docker_host=$(get_docker_host)
        warn "端口 5432 被占用"
        read -p "是否是已有的 PostgreSQL 服务? 输入连接字符串复用，或按 Enter 跳过: " pg_url
        if [ -n "$pg_url" ]; then
            DETECTED_POSTGRES_URL="$pg_url"
            USE_EXTERNAL_POSTGRES=true
            success "将使用指定的 PostgreSQL 服务"
            return 0
        else
            POSTGRES_PORT_TO_USE=$(find_available_port 5433)
            warn "PostgreSQL 将使用端口: $POSTGRES_PORT_TO_USE"
        fi
    fi

    info "未检测到可复用的 PostgreSQL，将启动新容器"
    return 1
}

# 自动检测并配置外部服务
auto_detect_services() {
    info "自动检测现有 Docker 服务..."
    echo ""

    # 检测 Redis
    detect_docker_redis || true

    # 检测 PostgreSQL
    detect_docker_postgres || true

    echo ""
}

# 显示 Banner
show_banner() {
    echo -e "${CYAN}"
    echo "╔══════════════════════════════════════════════╗"
    echo "║     NewAPI Model Check - 一键部署脚本       ║"
    echo "║  https://github.com/chxcodepro/newapi-model-check  ║"
    echo "╚══════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# 显示帮助
show_help() {
    echo "用法: ./deploy.sh [选项]"
    echo ""
    echo "部署模式:"
    echo "  --local       全本地模式 - PostgreSQL + Redis 本地运行（默认）"
    echo "  --cloud-db    云数据库模式 - 使用云端数据库，本地 Redis"
    echo "  --cloud-redis 云 Redis 模式 - 本地数据库，使用云端 Redis"
    echo "  --cloud       全云端模式 - 数据库和 Redis 都使用云端服务"
    echo ""
    echo "其他选项:"
    echo "  --rebuild     强制重新构建镜像"
    echo "  --skip-detect 跳过自动检测现有 Docker 服务"
    echo "  --help        显示此帮助信息"
    echo ""
    echo "自动检测功能:"
    echo "  脚本会自动检测 Docker 中已运行的 Redis/PostgreSQL 容器"
    echo "  如果检测到，可以选择复用这些服务"
    echo "  如果端口被占用但无法复用，会自动使用其他可用端口"
    echo ""
    echo "云服务推荐:"
    echo "  PostgreSQL: Supabase (免费), Neon (免费)"
    echo "  TiDB:       TiDB Cloud (免费额度)"
    echo "  Redis:      Upstash (免费), Redis Cloud"
    exit 0
}

# 安装 Docker
install_docker() {
    info "检测到系统未安装 Docker，正在自动安装..."
    echo ""

    # 检测操作系统
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        warn "macOS 系统请手动安装 Docker Desktop："
        echo "  下载地址: https://www.docker.com/products/docker-desktop/"
        echo ""
        read -p "安装完成后按 Enter 继续..."
    else
        # Linux - 先确保 curl 已安装
        if ! command -v curl &> /dev/null; then
            info "安装 curl..."
            if command -v apt-get &> /dev/null; then
                sudo apt-get update -qq && sudo apt-get install -y -qq curl
            elif command -v yum &> /dev/null; then
                sudo yum install -y -q curl
            elif command -v dnf &> /dev/null; then
                sudo dnf install -y -q curl
            else
                error "请先手动安装 curl"
            fi
        fi

        # 下载并执行 Docker 官方安装脚本
        info "下载 Docker 安装脚本..."
        curl -fsSL https://get.docker.com -o /tmp/get-docker.sh

        info "执行安装脚本..."
        sudo sh /tmp/get-docker.sh

        if [ $? -ne 0 ]; then
            error "Docker 安装失败，请手动安装后重试"
        fi

        # 启动 Docker 服务
        info "启动 Docker 服务..."
        if command -v systemctl &> /dev/null; then
            sudo systemctl start docker 2>/dev/null || true
            sudo systemctl enable docker 2>/dev/null || true
        fi

        # 将当前用户添加到 docker 组
        if ! groups | grep -q docker; then
            info "将当前用户添加到 docker 组..."
            sudo usermod -aG docker "$USER" 2>/dev/null || true
            warn "用户组已更新，如果后续命令失败，请重新登录或运行: newgrp docker"
        fi

        success "Docker 安装完成"
    fi
}

# 检查依赖
check_dependencies() {
    info "检查系统依赖..."

    # 检查 Docker 是否安装
    if ! command -v docker &> /dev/null; then
        warn "未找到 Docker"
        read -p "是否自动安装 Docker? (Y/n): " install_choice
        if [[ ! "$install_choice" =~ ^[Nn]$ ]]; then
            install_docker
        else
            error "Docker 是必需的，请先安装: https://docs.docker.com/get-docker/"
        fi
    fi

    # 检查 Docker 是否运行
    if ! docker info &> /dev/null; then
        warn "Docker 未运行"

        # 尝试启动 Docker
        if command -v systemctl &> /dev/null; then
            info "尝试启动 Docker 服务..."
            sudo systemctl start docker 2>/dev/null || true
            sleep 3
        fi

        # 再次检查
        if ! docker info &> /dev/null; then
            if [[ "$OSTYPE" == "darwin"* ]]; then
                error "请先启动 Docker Desktop 应用"
            else
                error "Docker 启动失败，请检查 Docker 服务状态: sudo systemctl status docker"
            fi
        fi
    fi

    # 检查 Docker Compose
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        error "未找到 Docker Compose，请确保 Docker 版本 >= 20.10"
    fi

    success "依赖检查通过"
}

# 生成随机密钥
generate_secret() {
    if command -v openssl &> /dev/null; then
        openssl rand -base64 32
    else
        cat /dev/urandom | tr -dc 'a-zA-Z0-9' | fold -w 32 | head -n 1
    fi
}

# 创建 .env 文件
setup_env() {
    local mode=$1

    if [ -f .env ]; then
        warn ".env 文件已存在"
        read -p "是否覆盖? (y/N): " overwrite
        if [[ ! "$overwrite" =~ ^[Yy]$ ]]; then
            info "保留现有 .env 文件"
            return
        fi
        cp .env .env.backup
        success "已备份到 .env.backup"
    fi

    info "创建 .env 配置文件..."
    cp .env.example .env

    # 根据自动检测结果调整部署模式
    local effective_mode=$mode

    if [ "$USE_EXTERNAL_REDIS" = true ] && [ "$USE_EXTERNAL_POSTGRES" = true ]; then
        effective_mode="cloud"
        info "将复用外部 Redis 和 PostgreSQL，不启动本项目的数据库容器"
    elif [ "$USE_EXTERNAL_POSTGRES" = true ]; then
        effective_mode="cloud-db"
        info "将复用外部 PostgreSQL，仅启动本项目的 Redis"
    elif [ "$USE_EXTERNAL_REDIS" = true ]; then
        effective_mode="cloud-redis"
        info "将复用外部 Redis，仅启动本项目的 PostgreSQL"
    fi

    # 设置部署模式
    case $effective_mode in
        local)
            sed -i 's/^COMPOSE_PROFILES=.*/COMPOSE_PROFILES="local"/' .env
            ;;
        cloud-db)
            sed -i 's/^COMPOSE_PROFILES=.*/COMPOSE_PROFILES="redis"/' .env
            ;;
        cloud-redis)
            sed -i 's/^COMPOSE_PROFILES=.*/COMPOSE_PROFILES="db"/' .env
            ;;
        cloud)
            sed -i 's/^COMPOSE_PROFILES=.*/#COMPOSE_PROFILES=""/' .env
            ;;
    esac

    # 配置检测到的外部 Redis
    if [ "$USE_EXTERNAL_REDIS" = true ] && [ -n "$DETECTED_REDIS_URL" ]; then
        info "配置外部 Redis: $DETECTED_REDIS_URL"
        local redis_url_escaped=$(echo "$DETECTED_REDIS_URL" | sed 's/[&/\]/\\&/g')
        sed -i "s|^# DOCKER_REDIS_URL=.*|DOCKER_REDIS_URL=\"$redis_url_escaped\"|" .env
        sed -i "s|^#DOCKER_REDIS_URL=.*|DOCKER_REDIS_URL=\"$redis_url_escaped\"|" .env
        # 确保添加配置行（如果不存在）
        if ! grep -q "^DOCKER_REDIS_URL=" .env; then
            echo "DOCKER_REDIS_URL=\"$DETECTED_REDIS_URL\"" >> .env
        fi
    fi

    # 配置检测到的外部 PostgreSQL
    if [ "$USE_EXTERNAL_POSTGRES" = true ] && [ -n "$DETECTED_POSTGRES_URL" ]; then
        info "配置外部 PostgreSQL"
        local db_url_escaped=$(echo "$DETECTED_POSTGRES_URL" | sed 's/[&/\]/\\&/g')
        sed -i "s|^# DOCKER_DATABASE_URL=.*|DOCKER_DATABASE_URL=\"$db_url_escaped\"|" .env
        sed -i "s|^#DOCKER_DATABASE_URL=.*|DOCKER_DATABASE_URL=\"$db_url_escaped\"|" .env
        if ! grep -q "^DOCKER_DATABASE_URL=" .env; then
            echo "DOCKER_DATABASE_URL=\"$DETECTED_POSTGRES_URL\"" >> .env
        fi
    fi

    # 配置端口（如果需要规避）
    if [ "$REDIS_PORT_TO_USE" != "6379" ]; then
        info "配置 Redis 端口: $REDIS_PORT_TO_USE"
        sed -i "s|^# REDIS_PORT=.*|REDIS_PORT=\"$REDIS_PORT_TO_USE\"|" .env
        if ! grep -q "^REDIS_PORT=" .env; then
            echo "REDIS_PORT=\"$REDIS_PORT_TO_USE\"" >> .env
        fi
    fi

    if [ "$POSTGRES_PORT_TO_USE" != "5432" ]; then
        info "配置 PostgreSQL 端口: $POSTGRES_PORT_TO_USE"
        sed -i "s|^# POSTGRES_PORT=.*|POSTGRES_PORT=\"$POSTGRES_PORT_TO_USE\"|" .env
        if ! grep -q "^POSTGRES_PORT=" .env; then
            echo "POSTGRES_PORT=\"$POSTGRES_PORT_TO_USE\"" >> .env
        fi
    fi

    # 生成 JWT 密钥
    local jwt_secret=$(generate_secret)
    local jwt_secret_escaped=$(echo "$jwt_secret" | sed 's/[&/\]/\\&/g')
    sed -i "s|^JWT_SECRET=.*|JWT_SECRET=\"$jwt_secret_escaped\"|" .env
    success "已生成 JWT 密钥"

    # 设置管理员密码
    echo ""
    read -sp "请输入管理员密码 (留空使用默认 admin123): " admin_pwd
    echo ""
    if [ -n "$admin_pwd" ]; then
        local admin_pwd_escaped=$(echo "$admin_pwd" | sed 's/[&/\]/\\&/g')
        sed -i "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=\"$admin_pwd_escaped\"|" .env
        success "已设置管理员密码"
    else
        sed -i 's|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD="admin123"|' .env
        warn "使用默认密码 admin123，建议后续修改"
    fi

    # 云数据库配置（仅当未自动检测到外部服务时询问）
    if [[ "$mode" == "cloud-db" || "$mode" == "cloud" ]] && [ "$USE_EXTERNAL_POSTGRES" != true ]; then
        echo ""
        info "请配置云数据库连接..."
        echo "支持的格式:"
        echo "  Supabase:  postgresql://postgres:password@db.xxx.supabase.co:5432/postgres"
        echo "  Neon:      postgresql://user:password@xxx.neon.tech/neondb?sslmode=require"
        echo "  TiDB:      mysql://user:password@gateway.tidbcloud.com:4000/dbname"
        echo ""
        read -p "数据库连接字符串: " db_url
        if [ -n "$db_url" ]; then
            # 转义特殊字符
            db_url_escaped=$(echo "$db_url" | sed 's/[&/\]/\\&/g')
            sed -i "s|^# DOCKER_DATABASE_URL=.*|DOCKER_DATABASE_URL=\"$db_url_escaped\"|" .env
            sed -i "s|^#DOCKER_DATABASE_URL=.*|DOCKER_DATABASE_URL=\"$db_url_escaped\"|" .env
            success "已配置云数据库"
        else
            error "云数据库模式必须提供连接字符串"
        fi
    fi

    # 云 Redis 配置（仅当未自动检测到外部服务时询问）
    if [[ "$mode" == "cloud-redis" || "$mode" == "cloud" ]] && [ "$USE_EXTERNAL_REDIS" != true ]; then
        echo ""
        info "请配置云 Redis 连接..."
        echo "支持的格式:"
        echo "  Upstash:     redis://default:password@xxx.upstash.io:6379"
        echo "  Redis Cloud: redis://user:password@xxx.redis.cloud:port"
        echo ""
        read -p "Redis 连接字符串: " redis_url
        if [ -n "$redis_url" ]; then
            redis_url_escaped=$(echo "$redis_url" | sed 's/[&/\]/\\&/g')
            sed -i "s|^# DOCKER_REDIS_URL=.*|DOCKER_REDIS_URL=\"$redis_url_escaped\"|" .env
            sed -i "s|^#DOCKER_REDIS_URL=.*|DOCKER_REDIS_URL=\"$redis_url_escaped\"|" .env
            success "已配置云 Redis"
        else
            error "云 Redis 模式必须提供连接字符串"
        fi
    fi

    success ".env 配置完成"
}

# 启动服务
start_services() {
    local rebuild=$1

    info "启动 Docker 服务..."

    # 使用 docker compose 或 docker-compose
    local compose_cmd="docker compose"
    if ! docker compose version &> /dev/null; then
        compose_cmd="docker-compose"
    fi

    if [ "$rebuild" = "true" ]; then
        info "本地构建模式..."
        $compose_cmd up -d --build
    else
        info "拉取预构建镜像..."
        $compose_cmd pull app 2>/dev/null || warn "无法拉取镜像，将使用本地构建"
        $compose_cmd up -d
    fi

    success "服务启动中..."

    # 等待服务就绪
    info "等待服务就绪..."
    sleep 5

    # 检查应用容器状态
    local max_attempts=30
    local attempt=0
    while [ $attempt -lt $max_attempts ]; do
        if docker ps | grep -q "newapi-model-check.*Up"; then
            break
        fi
        attempt=$((attempt + 1))
        echo -n "."
        sleep 2
    done
    echo ""

    if [ $attempt -eq $max_attempts ]; then
        error "服务启动超时，请检查日志: docker logs newapi-model-check"
    fi

    success "服务已启动"
}

# 初始化数据库
init_database() {
    info "初始化数据库..."

    # 使用 docker compose 或 docker-compose
    local compose_cmd="docker compose"
    if ! docker compose version &> /dev/null; then
        compose_cmd="docker-compose"
    fi

    # 情况1: 使用本项目的 PostgreSQL 容器
    if docker ps --format '{{.Names}}' | grep -q "newapi-postgres"; then
        info "等待数据库就绪..."
        local max_attempts=30
        local attempt=0
        while [ $attempt -lt $max_attempts ]; do
            if $compose_cmd exec -T postgres pg_isready -U newapi -d newapi_monitor &>/dev/null; then
                break
            fi
            attempt=$((attempt + 1))
            echo -n "."
            sleep 2
        done
        echo ""

        if [ $attempt -eq $max_attempts ]; then
            warn "等待数据库超时，尝试继续..."
        fi

        # 使用项目自带的 SQL 脚本初始化数据库（避免 Prisma CLI 版本兼容问题）
        info "创建数据库表..."
        if cat prisma/init.postgresql.sql | $compose_cmd exec -T postgres psql -U newapi -d newapi_monitor; then
            success "数据库初始化完成"
        else
            error "数据库初始化失败"
        fi

    # 情况2: 复用外部 Docker PostgreSQL 容器
    elif [ "$USE_EXTERNAL_POSTGRES" = true ] && [ -n "$DETECTED_POSTGRES_CONTAINER" ]; then
        info "使用外部 PostgreSQL 容器: $DETECTED_POSTGRES_CONTAINER"

        # 等待数据库就绪
        local max_attempts=30
        local attempt=0
        local pg_user=${DETECTED_POSTGRES_USER:-postgres}
        local pg_db=${DETECTED_POSTGRES_DB:-postgres}

        info "等待数据库就绪..."
        while [ $attempt -lt $max_attempts ]; do
            if docker exec "$DETECTED_POSTGRES_CONTAINER" pg_isready -U "$pg_user" -d "$pg_db" &>/dev/null; then
                break
            fi
            attempt=$((attempt + 1))
            echo -n "."
            sleep 2
        done
        echo ""

        if [ $attempt -eq $max_attempts ]; then
            warn "等待数据库超时，尝试继续..."
        fi

        # 使用项目自带的 SQL 脚本初始化数据库
        info "创建数据库表..."
        if cat prisma/init.postgresql.sql | docker exec -i "$DETECTED_POSTGRES_CONTAINER" psql -U "$pg_user" -d "$pg_db"; then
            success "数据库初始化完成"
        else
            warn "数据库初始化失败，可能表已存在（可忽略）"
        fi

    # 情况3: 云数据库或其他外部数据库（无法自动初始化）
    else
        warn "未检测到可自动初始化的 PostgreSQL 容器"
        info "请手动执行数据库初始化: psql < prisma/init.postgresql.sql"
    fi
}

# 显示部署结果
show_result() {
    local port=${APP_PORT:-3000}

    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║           部署成功!                      ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "访问地址: ${CYAN}http://localhost:${port}${NC}"
    echo -e "管理密码: 你设置的 ADMIN_PASSWORD"
    echo ""

    # 显示服务配置信息
    echo "服务配置:"
    if [ "$USE_EXTERNAL_REDIS" = true ]; then
        echo -e "  Redis:      ${CYAN}复用外部${NC} ($DETECTED_REDIS_URL)"
    elif [ "$REDIS_PORT_TO_USE" != "6379" ]; then
        echo -e "  Redis:      ${CYAN}本项目容器${NC} (端口: $REDIS_PORT_TO_USE)"
    else
        echo -e "  Redis:      ${CYAN}本项目容器${NC} (端口: 6379)"
    fi

    if [ "$USE_EXTERNAL_POSTGRES" = true ]; then
        # 隐藏密码显示
        local display_url=$(echo "$DETECTED_POSTGRES_URL" | sed 's/:[^:@]*@/:***@/')
        echo -e "  PostgreSQL: ${CYAN}复用外部${NC} ($display_url)"
    elif [ "$POSTGRES_PORT_TO_USE" != "5432" ]; then
        echo -e "  PostgreSQL: ${CYAN}本项目容器${NC} (端口: $POSTGRES_PORT_TO_USE)"
    else
        echo -e "  PostgreSQL: ${CYAN}本项目容器${NC} (端口: 5432)"
    fi
    echo ""

    echo "常用命令:"
    echo "  查看日志:   docker logs -f newapi-model-check"
    echo "  重启服务:   docker compose restart"
    echo "  停止服务:   docker compose down"
    echo "  更新部署:   git pull && docker compose up -d --build"
    echo ""
    echo "项目地址: https://github.com/chxcodepro/newapi-model-check"
    echo ""
}

# 主函数
main() {
    show_banner

    # 解析参数
    local mode="local"
    local rebuild="false"
    local skip_detect="false"

    while [[ $# -gt 0 ]]; do
        case $1 in
            --local)
                mode="local"
                shift
                ;;
            --cloud-db)
                mode="cloud-db"
                shift
                ;;
            --cloud-redis)
                mode="cloud-redis"
                shift
                ;;
            --cloud)
                mode="cloud"
                shift
                ;;
            --rebuild)
                rebuild="true"
                shift
                ;;
            --skip-detect)
                skip_detect="true"
                shift
                ;;
            --help|-h)
                show_help
                ;;
            *)
                error "未知选项: $1，使用 --help 查看帮助"
                ;;
        esac
    done

    info "部署模式: $mode"
    echo ""

    # 执行部署流程
    check_dependencies

    # 自动检测现有服务（除非明确跳过或使用全云端模式）
    if [ "$skip_detect" != "true" ] && [ "$mode" != "cloud" ]; then
        auto_detect_services
    fi

    setup_env "$mode"
    generate_compose_override
    start_services "$rebuild"
    init_database
    show_result
}

# 运行主函数
main "$@"
