#!/bin/bash
# ==========================================
# Model Check - 一键部署脚本
# ==========================================
# 项目地址: https://github.com/chxcodepro/model-check
#
# 用法: ./deploy.sh [选项]
#
# 选项:
#   --local       全本地模式（PostgreSQL + Redis 本地运行）
#   --cloud-db    云数据库模式（仅启动 Redis）
#   --cloud-redis 云 Redis 模式（仅启动 PostgreSQL）
#   --cloud       全云端模式（不启动数据库服务）
#   --rebuild     强制重新构建镜像
#   --quick       快速模式（跳过可选配置）
#   --help        显示帮助信息
#
# 示例:
#   ./deploy.sh --local        # 最简单，全部本地运行
#   ./deploy.sh --cloud-db     # 使用 Supabase/Neon 等云数据库
#   ./deploy.sh --cloud        # 数据库和 Redis 都用云端
#   ./deploy.sh --quick        # 快速部署，跳过可选配置

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

# 全局变量：端口配置
REDIS_PORT_TO_USE=6379
POSTGRES_PORT_TO_USE=5432

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

# 检测端口冲突并为 Redis 分配可用端口
detect_redis_port() {
    # 检查端口 6379 是否被占用
    if check_port_in_use 6379; then
        warn "端口 6379 已被占用，查找可用端口..."
        REDIS_PORT_TO_USE=$(find_available_port 6380)
        warn "Redis 将使用端口: $REDIS_PORT_TO_USE"
    fi
}

# 检测端口冲突并为 PostgreSQL 分配可用端口
detect_postgres_port() {
    # 检查端口 5432 是否被占用
    if check_port_in_use 5432; then
        warn "端口 5432 已被占用，查找可用端口..."
        POSTGRES_PORT_TO_USE=$(find_available_port 5433)
        warn "PostgreSQL 将使用端口: $POSTGRES_PORT_TO_USE"
    fi
}

# 检测端口冲突
check_port_conflicts() {
    info "检测端口冲突..."

    # 检测 Redis 端口
    detect_redis_port

    # 检测 PostgreSQL 端口
    detect_postgres_port

    echo ""
}

# 显示 Banner
show_banner() {
    echo -e "${CYAN}"
    echo "╔══════════════════════════════════════════════╗"
    echo "║       Model Check - 一键部署脚本                ║"
    echo "║  https://github.com/chxcodepro/model-check   ║"
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
    echo "  --quick       快速模式 - 跳过可选配置（WebDAV、代理密钥等）"
    echo "  --update      更新部署 - 拉取最新代码并重启服务"
    echo "  --status      查看服务状态"
    echo "  --help        显示此帮助信息"
    echo ""
    echo "端口冲突处理:"
    echo "  如果默认端口 (6379/5432) 被占用，会自动使用其他可用端口"
    echo ""
    echo "云服务推荐:"
    echo "  PostgreSQL: Supabase (免费), Neon (免费)"
    echo "  Redis:      Upstash (免费), Redis Cloud"
    echo ""
    echo "主要功能:"
    echo "  多密钥管理 - 在管理面板创建多个代理密钥，支持权限控制"
    echo "  定时检测   - 可视化配置检测时间、并发数、检测范围"
    echo "  WebDAV同步 - 支持坚果云、NextCloud，多设备同步渠道配置"
    exit 0
}

# 更新部署
do_update() {
    info "更新部署..."

    # 使用 docker compose 或 docker-compose
    local compose_cmd="docker compose"
    if ! docker compose version &> /dev/null; then
        compose_cmd="docker-compose"
    fi

    # 拉取最新代码
    info "拉取最新代码..."
    if git pull; then
        success "代码更新完成"
    else
        error "代码拉取失败，请检查 git 状态"
    fi

    # 拉取最新镜像
    info "拉取最新镜像..."
    $compose_cmd pull app 2>/dev/null || warn "无法拉取镜像，将使用本地构建"

    # 重启服务
    info "重启服务..."
    $compose_cmd up -d --build

    info "同步数据库表结构..."
    if docker ps --format '{{.Names}}' | grep -q "model-check-postgres"; then
        if cat prisma/init.postgresql.sql | $compose_cmd exec -T postgres psql -U modelcheck -d model_check; then
            success "数据库同步完成（SQL 幂等脚本）"
        else
            warn "SQL 同步失败，请检查数据库连接与权限"
        fi
    else
        warn "未检测到本地 PostgreSQL 容器，无法自动执行 SQL 同步，请检查 DATABASE_URL 与网络后重试"
    fi

    success "更新完成！"
    echo ""
    echo "查看日志: docker logs -f model-check"
}

# 查看服务状态
show_status() {
    echo -e "${CYAN}服务状态${NC}"
    echo "=========================================="

    # 使用 docker compose 或 docker-compose
    local compose_cmd="docker compose"
    if ! docker compose version &> /dev/null; then
        compose_cmd="docker-compose"
    fi

    # 显示容器状态
    echo ""
    echo "容器状态:"
    docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -E "model-check|NAMES" || echo "  无运行中的容器"

    # 检查应用健康状态
    echo ""
    if docker ps | grep -q "model-check.*Up"; then
        echo -e "应用状态: ${GREEN}运行中${NC}"

        # 尝试访问健康检查接口
        if command -v curl &> /dev/null; then
            local health=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/status 2>/dev/null)
            if [ "$health" = "200" ]; then
                echo -e "健康检查: ${GREEN}正常${NC}"
            else
                echo -e "健康检查: ${YELLOW}异常 (HTTP $health)${NC}"
            fi
        fi
    else
        echo -e "应用状态: ${RED}未运行${NC}"
    fi

    # 显示配置状态
    echo ""
    echo "配置状态:"
    if [ -f .env ]; then
        if grep -q "^WEBDAV_URL=" .env && ! grep -q "^WEBDAV_URL=\"\"" .env && ! grep -q "^# WEBDAV_URL=" .env; then
            echo -e "  WebDAV:     ${GREEN}已配置${NC}"
        else
            echo -e "  WebDAV:     ${YELLOW}未配置${NC}"
        fi

        if grep -q "^PROXY_API_KEY=" .env && ! grep -q "^PROXY_API_KEY=\"\"" .env && ! grep -q "^# PROXY_API_KEY=" .env; then
            echo -e "  代理密钥:   ${GREEN}已配置${NC}"
        else
            echo -e "  代理密钥:   ${YELLOW}自动生成${NC}"
        fi

        if grep -q "^GLOBAL_PROXY=" .env && ! grep -q "^GLOBAL_PROXY=\"\"" .env && ! grep -q "^# GLOBAL_PROXY=" .env; then
            echo -e "  全局代理:   ${GREEN}已配置${NC}"
        else
            echo -e "  全局代理:   ${YELLOW}未配置${NC}"
        fi
    else
        echo -e "  ${YELLOW}.env 文件不存在${NC}"
    fi

    echo ""
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

# 跨平台 sed 原地编辑（兼容 macOS BSD sed）
sed_i() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "$@"
    else
        sed -i "$@"
    fi
}

# sed 替换串转义（使用 | 作为分隔符时）
escape_for_sed() {
    printf '%s' "$1" | sed 's/[&|\\]/\\&/g'
}

# 创建 .env 文件
setup_env() {
    local mode=$1
    local quick=$2

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

    # 设置部署模式
    case $mode in
        local)
            sed_i 's/^COMPOSE_PROFILES=.*/COMPOSE_PROFILES="local"/' .env
            ;;
        cloud-db)
            sed_i 's/^COMPOSE_PROFILES=.*/COMPOSE_PROFILES="redis"/' .env
            ;;
        cloud-redis)
            sed_i 's/^COMPOSE_PROFILES=.*/COMPOSE_PROFILES="db"/' .env
            ;;
        cloud)
            sed_i 's/^COMPOSE_PROFILES=.*/#COMPOSE_PROFILES=""/' .env
            ;;
    esac

    # 配置端口（如果默认端口被占用）
    if [ "$REDIS_PORT_TO_USE" != "6379" ]; then
        info "配置 Redis 端口: $REDIS_PORT_TO_USE"
        sed_i "s|^# REDIS_PORT=.*|REDIS_PORT=\"$REDIS_PORT_TO_USE\"|" .env
        if ! grep -q "^REDIS_PORT=" .env; then
            echo "REDIS_PORT=\"$REDIS_PORT_TO_USE\"" >> .env
        fi
    fi

    if [ "$POSTGRES_PORT_TO_USE" != "5432" ]; then
        info "配置 PostgreSQL 端口: $POSTGRES_PORT_TO_USE"
        sed_i "s|^# POSTGRES_PORT=.*|POSTGRES_PORT=\"$POSTGRES_PORT_TO_USE\"|" .env
        if ! grep -q "^POSTGRES_PORT=" .env; then
            echo "POSTGRES_PORT=\"$POSTGRES_PORT_TO_USE\"" >> .env
        fi
    fi

    # 生成 JWT 密钥
    local jwt_secret=$(generate_secret)
    local jwt_secret_escaped=$(escape_for_sed "$jwt_secret")
    sed_i "s|^JWT_SECRET=.*|JWT_SECRET=\"$jwt_secret_escaped\"|" .env
    success "已生成 JWT 密钥"

    # 设置管理员密码
    echo ""
    read -sp "请输入管理员密码 (留空使用默认 admin123): " admin_pwd
    echo ""
    if [ -n "$admin_pwd" ]; then
        local admin_pwd_escaped=$(escape_for_sed "$admin_pwd")
        sed_i "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=\"$admin_pwd_escaped\"|" .env
        success "已设置管理员密码"
    else
        sed_i 's|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD="admin123"|' .env
        warn "使用默认密码 admin123，建议后续修改"
    fi

    # 云数据库配置
    if [[ "$mode" == "cloud-db" || "$mode" == "cloud" ]]; then
        echo ""
        info "请配置云数据库连接..."
        echo "支持的格式:"
        echo "  Supabase:  postgresql://postgres:password@db.xxx.supabase.co:5432/postgres"
        echo "  Neon:      postgresql://user:password@xxx.neon.tech/neondb?sslmode=require"
        echo ""
        read -p "数据库连接字符串: " db_url
        if [ -n "$db_url" ]; then
            # 转义特殊字符
            db_url_escaped=$(escape_for_sed "$db_url")
            sed_i "s|^# DOCKER_DATABASE_URL=.*|DOCKER_DATABASE_URL=\"$db_url_escaped\"|" .env
            sed_i "s|^#DOCKER_DATABASE_URL=.*|DOCKER_DATABASE_URL=\"$db_url_escaped\"|" .env
            success "已配置云数据库"
        else
            error "云数据库模式必须提供连接字符串"
        fi
    fi

    # 云 Redis 配置
    if [[ "$mode" == "cloud-redis" || "$mode" == "cloud" ]]; then
        echo ""
        info "请配置云 Redis 连接..."
        echo "支持的格式:"
        echo "  Upstash:     redis://default:password@xxx.upstash.io:6379"
        echo "  Redis Cloud: redis://user:password@xxx.redis.cloud:port"
        echo ""
        read -p "Redis 连接字符串: " redis_url
        if [ -n "$redis_url" ]; then
            redis_url_escaped=$(escape_for_sed "$redis_url")
            sed_i "s|^# DOCKER_REDIS_URL=.*|DOCKER_REDIS_URL=\"$redis_url_escaped\"|" .env
            sed_i "s|^#DOCKER_REDIS_URL=.*|DOCKER_REDIS_URL=\"$redis_url_escaped\"|" .env
            success "已配置云 Redis"
        else
            error "云 Redis 模式必须提供连接字符串"
        fi
    fi

    # 快速模式跳过可选配置
    if [ "$quick" = "true" ]; then
        success ".env 配置完成（快速模式）"
        return
    fi

    # ========================================
    # 可选配置
    # ========================================
    echo ""
    info "以下为可选配置，可直接回车跳过"
    echo ""

    # 代理密钥配置
    read -p "设置代理接口密钥 (留空则自动生成，重启后会变化): " proxy_key
    if [ -n "$proxy_key" ]; then
        local proxy_key_escaped=$(escape_for_sed "$proxy_key")
        sed_i "s|^# PROXY_API_KEY=.*|PROXY_API_KEY=\"$proxy_key_escaped\"|" .env
        success "已设置代理密钥"
    fi

    # WebDAV 配置
    echo ""
    read -p "是否配置 WebDAV 同步? (y/N): " config_webdav
    if [[ "$config_webdav" =~ ^[Yy]$ ]]; then
        echo ""
        info "WebDAV 同步配置"
        echo "支持: 坚果云、NextCloud、Alist 等 WebDAV 服务"
        echo ""

        read -p "WebDAV URL (如 https://dav.jianguoyun.com/dav/sync): " webdav_url
        if [ -n "$webdav_url" ]; then
            webdav_url_escaped=$(escape_for_sed "$webdav_url")
            sed_i "s|^# WEBDAV_URL=.*|WEBDAV_URL=\"$webdav_url_escaped\"|" .env
        fi

        read -p "WebDAV 用户名: " webdav_user
        if [ -n "$webdav_user" ]; then
            webdav_user_escaped=$(escape_for_sed "$webdav_user")
            sed_i "s|^# WEBDAV_USERNAME=.*|WEBDAV_USERNAME=\"$webdav_user_escaped\"|" .env
        fi

        read -sp "WebDAV 密码/应用密码: " webdav_pass
        echo ""
        if [ -n "$webdav_pass" ]; then
            webdav_pass_escaped=$(escape_for_sed "$webdav_pass")
            sed_i "s|^# WEBDAV_PASSWORD=.*|WEBDAV_PASSWORD=\"$webdav_pass_escaped\"|" .env
        fi

        if [ -n "$webdav_url" ] && [ -n "$webdav_user" ] && [ -n "$webdav_pass" ]; then
            success "已配置 WebDAV 同步"
        else
            warn "WebDAV 配置不完整，可稍后在 .env 中补充"
        fi
    fi

    # 全局代理配置
    echo ""
    read -p "全局代理地址 (如 http://127.0.0.1:7890，留空跳过): " global_proxy
    if [ -n "$global_proxy" ]; then
        global_proxy_escaped=$(escape_for_sed "$global_proxy")
        sed_i "s|^# GLOBAL_PROXY=.*|GLOBAL_PROXY=\"$global_proxy_escaped\"|" .env
        success "已设置全局代理"
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
        if $compose_cmd pull app 2>/dev/null; then
            $compose_cmd up -d
        else
            warn "无法拉取预构建镜像，自动切换到本地构建..."
            $compose_cmd up -d --build
        fi
    fi

    success "服务启动中..."

    sleep 5

    # 检查应用容器状态
    local max_attempts=30
    local attempt=0
    while [ $attempt -lt $max_attempts ]; do
        if docker ps | grep -q "model-check.*Up"; then
            break
        fi
        attempt=$((attempt + 1))
        echo -n "."
        sleep 2
    done
    echo ""

    if [ $attempt -eq $max_attempts ]; then
        error "服务启动超时，请检查日志: docker logs model-check"
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

    local has_local_postgres="false"
    if docker ps --format '{{.Names}}' | grep -q "model-check-postgres"; then
        has_local_postgres="true"
        info "等待数据库就绪..."
        local max_attempts=30
        local attempt=0
        while [ $attempt -lt $max_attempts ]; do
            if $compose_cmd exec -T postgres pg_isready -U modelcheck -d model_check &>/dev/null; then
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

    fi

    info "同步数据库结构..."
    if [ "$has_local_postgres" = "true" ]; then
        if cat prisma/init.postgresql.sql | $compose_cmd exec -T postgres psql -U modelcheck -d model_check; then
            success "数据库初始化完成（SQL 幂等脚本）"
        else
            warn "SQL 同步失败，请检查数据库连接与权限"
        fi
    else
        warn "未检测到本地 PostgreSQL 容器，跳过自动 SQL 同步"
        info "请检查 .env 中 DATABASE_URL/DOCKER_DATABASE_URL，手动执行 prisma/init.postgresql.sql"
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
    if [ "$REDIS_PORT_TO_USE" != "6379" ]; then
        echo -e "  Redis:      ${CYAN}本项目容器${NC} (端口: $REDIS_PORT_TO_USE)"
    else
        echo -e "  Redis:      ${CYAN}本项目容器${NC} (端口: 6379)"
    fi

    if [ "$POSTGRES_PORT_TO_USE" != "5432" ]; then
        echo -e "  PostgreSQL: ${CYAN}本项目容器${NC} (端口: $POSTGRES_PORT_TO_USE)"
    else
        echo -e "  PostgreSQL: ${CYAN}本项目容器${NC} (端口: 5432)"
    fi

    # 检查可选配置状态
    if [ -f .env ]; then
        if grep -q "^WEBDAV_URL=" .env && ! grep -q "^WEBDAV_URL=\"\"" .env && ! grep -q "^# WEBDAV_URL=" .env; then
            echo -e "  WebDAV:     ${GREEN}已配置${NC}"
        else
            echo -e "  WebDAV:     ${YELLOW}未配置${NC} (可在 .env 中设置)"
        fi

        if grep -q "^PROXY_API_KEY=" .env && ! grep -q "^PROXY_API_KEY=\"\"" .env && ! grep -q "^# PROXY_API_KEY=" .env; then
            echo -e "  代理密钥:   ${GREEN}已配置${NC}"
        else
            echo -e "  代理密钥:   ${YELLOW}自动生成${NC} (可在管理面板创建多个密钥)"
        fi

        if grep -q "^GLOBAL_PROXY=" .env && ! grep -q "^GLOBAL_PROXY=\"\"" .env && ! grep -q "^# GLOBAL_PROXY=" .env; then
            echo -e "  全局代理:   ${GREEN}已配置${NC}"
        fi
    fi
    echo ""

    echo "主要功能:"
    echo "  多密钥管理 - 管理面板 → 代理密钥管理 → 添加"
    echo "  定时检测   - 管理面板 → 顶部齿轮按钮"
    echo "  WebDAV同步 - 管理面板 → 渠道管理 → 同步按钮"
    echo ""

    echo "常用命令:"
    echo "  查看日志:   docker logs -f model-check"
    echo "  重启服务:   docker compose restart"
    echo "  停止服务:   docker compose down"
    echo "  更新部署:   git pull && docker compose up -d --build"
    echo ""

    echo "配置文件: .env (修改后需重启服务)"
    echo "项目地址: https://github.com/chxcodepro/model-check"
    echo ""
}

# 主函数
main() {
    show_banner

    # 解析参数
    local mode="local"
    local rebuild="false"
    local quick="false"

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
            --quick)
                quick="true"
                shift
                ;;
            --update)
                do_update
                exit 0
                ;;
            --status)
                show_status
                exit 0
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
    if [ "$quick" = "true" ]; then
        info "快速模式: 跳过可选配置"
    fi
    echo ""

    # 执行部署流程
    check_dependencies

    # 检测端口冲突（本地模式时需要启动数据库容器）
    if [ "$mode" = "local" ] || [ "$mode" = "cloud-db" ] || [ "$mode" = "cloud-redis" ]; then
        check_port_conflicts
    fi

    setup_env "$mode" "$quick"
    start_services "$rebuild"
    init_database
    show_result
}

# 运行主函数
main "$@"
