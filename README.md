# 🏥 Radiology Report Generator Backend

Production-ready backend for AI-powered radiology report generation with Supabase authentication.

## 🚀 Features

- **AI Report Generation** - OpenAI-powered radiology reports

- **Supabase Authentication** - Complete user management system
- **Template Management** - Custom report templates
- **Audio Transcription** - Deepgram integration

- **RESTful API** - Clean, documented endpoints
- **Production Ready** - Docker, health checks, logging

## 🛠️ Quick Start

### Prerequisites
- Node.js 18+
- Docker (optional)
- Supabase project
- OpenAI API key
- Deepgram API key

### Environment Setup
```bash
cp .env.example .env
# Edit .env with your API keys
```

### Local Development
```bash
npm install
npm run dev
```

### Production Deployment
```bash
# Docker
docker-compose up -d

# Or direct
npm run prod
```

## 🔌 API Endpoints

### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `POST /api/auth/dev-login` - Development login
- `GET /api/auth/me` - Get current user

### Reports
- `POST /api/generate-report` - Generate AI report

- `POST /api/transcribe` - Audio transcription

### Templates
- `GET /api/templates` - Get user templates
- `POST /api/templates` - Create template
- `PUT /api/templates/:id` - Update template
- `DELETE /api/templates/:id` - Delete template

### Health
- `GET /health` - Health check
- `GET /api/health` - API health check

## ⚙️ Configuration

See `.env.example` for all available environment variables.





### Required Variables
- `OPENAI_API_KEY` - OpenAI API key
- `DEEPGRAM_API_KEY` - Deepgram API key
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_ANON_KEY` - Supabase anonymous key
- `SUPABASE_SERVICE_KEY` - Supabase service role key

## 📦 Deployment

### Docker
```bash
docker build -t radiology-backend .
docker run -p 3001:3001 --env-file .env radiology-backend
```

### Docker Compose
```bash
docker-compose up -d
```

### Environment Variables
- `NODE_ENV` - Environment (development/production)
- `PORT` - Server port (default: 3001)
- `CORS_ORIGIN` - Allowed CORS origins

## 🧪 Testing

```bash
# Test health endpoint
curl http://localhost:3001/health

# Test dev login
curl -X POST http://localhost:3001/api/auth/dev-login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123"}'
```

## 🔒 Security

- JWT-based authentication
- Row Level Security (RLS) in Supabase
- CORS protection
- Non-root Docker user
- Environment variable protection

## 📝 License

MIT License - see LICENSE file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request
