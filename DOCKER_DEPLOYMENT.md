# 🐳 Docker Deployment Guide

This project offers two deployment configurations:

## 📋 Quick Start

### 🌟 Production (Recommended) - MongoDB Atlas
```bash
# 1. Copy and configure environment
cp .env.example .env
# Edit .env with your production values

# 2. Deploy
docker-compose -f docker-compose.production.yml up -d
```

### 🔧 Development - Local MongoDB
```bash
# 1. Copy and configure development environment
cp .env.development.example .env.development
# Edit .env.development if needed (optional)

# 2. Deploy with local database
docker-compose -f docker-compose.development.yml up -d
```

---

## 🌟 Production Deployment (MongoDB Atlas)

**Best for:** Production websites, VPS deployments, live applications

### ✅ Advantages:
- Managed MongoDB (no server maintenance)
- Automatic backups and scaling
- Better performance and reliability
- Less resource usage on your server
- Professional setup

### 📋 Setup Steps:

1. **Create MongoDB Atlas Account**
   - Go to [MongoDB Atlas](https://cloud.mongodb.com)
   - Create a free cluster
   - Get your connection string

2. **Configure Environment**
   ```bash
   cp .env.example .env
   ```
   Edit `.env`:
   ```env
   NEXTAUTH_URL=https://yourdomain.com
   MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/aiogames
   NEXTAUTH_SECRET=your-super-secret-key
   ```

3. **Deploy**
   ```bash
   docker-compose -f docker-compose.production.yml up -d
   ```

4. **Access Your App**
   - Website: `http://localhost:3000`
   - First time? Visit `/api/admin/seed` to create admin user

---

## 🔧 Development Setup (Local MongoDB)

**Best for:** Development, testing, local development

### ⚠️ Not Recommended For Production
This setup runs MongoDB containers on your server, which uses more resources and requires maintenance.

### 📋 Setup Steps:

1. **Configure Development Environment**
   ```bash
   cp .env.development.example .env.development
   ```
   Edit `.env.development` if needed (defaults should work)

2. **Deploy**
   ```bash
   docker-compose -f docker-compose.development.yml up -d
   ```

3. **Access Services**
   - Website: `http://localhost:3000`
   - MongoDB Admin: `http://localhost:8081` (admin/admin)
   - MongoDB Direct: `localhost:27017`

---

## 📁 Environment File Structure

```
.env                      # Production environment (from .env.example)
.env.development          # Development environment (from .env.development.example)
.env.example              # Production template
.env.development.example  # Development template
```

### Standard Convention:
- **`.env`** - Default production environment
- **`.env.development`** - Development environment
- **`.env.example`** - Template for production setup

## 🛠️ Common Commands

```bash
# View logs
docker-compose -f docker-compose.production.yml logs -f

# Stop services
docker-compose -f docker-compose.production.yml down

# Rebuild and restart
docker-compose -f docker-compose.production.yml up -d --build

# Check container status
docker-compose -f docker-compose.production.yml ps
```

---

## 🆘 Troubleshooting

### App won't start
1. Check logs: `docker-compose -f [config-file] logs aiogames`
2. Verify environment variables in `.env.production`
3. Ensure MongoDB connection string is correct

### Can't connect to database
1. **Production**: Check MongoDB Atlas network access and credentials
2. **Development**: Ensure MongoDB container is running

### Port conflicts
- Change ports in docker-compose file if 3000 is in use
- Update `NEXTAUTH_URL` to match new port

---

## 🧹 Cleanup Old Files

After switching to this simplified setup, you can remove:
- `Dockerfile` (old)
- `Dockerfile.alt` (old) 
- `Dockerfile.prod` (old)
- `docker-compose.yml` (old)
- `docker-compose.dev.yml` (old)
- `docker-compose.prod.yml` (old)