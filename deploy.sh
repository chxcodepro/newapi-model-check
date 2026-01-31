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
    echo "  --help        显示此帮助信息"
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
        # Linux - 使用一键安装脚本
        info "使用一键安装脚本安装 Docker..."
        echo ""
        bash <(curl -sSL https://xuanyuan.cloud/docker.sh)

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

    # 设置部署模式
    case $mode in
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

    # 云数据库配置
    if [[ "$mode" == "cloud-db" || "$mode" == "cloud" ]]; then
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

    # 检查是否有本地 PostgreSQL 容器
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
    else
        # 云数据库模式，跳过自动初始化
        warn "未检测到本地 PostgreSQL 容器，请手动执行 prisma/init.postgresql.sql"
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
    setup_env "$mode"
    start_services "$rebuild"
    init_database
    show_result
}

# 运行主函数
main "$@"
