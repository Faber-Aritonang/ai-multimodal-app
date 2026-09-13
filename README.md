# AI Multimodal Application

Full-stack web application with AI-powered multimodal features including chat, text-to-image, text-to-video, and more. Built with free tech stack, designed for easy scale-up to paid services.

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Backend Setup](#backend-setup)
- [Frontend Setup](#frontend-setup)
- [API Documentation](#api-documentation)
- [Deployment](#deployment)
- [Architecture](#architecture)
- [Future Improvements](#future-improvements)

## Features

### Available Features
- **Chat**: AI-powered conversational chat (available for all users including guests)
- **User Authentication**: Google Sign-In via Firebase
- **Member Registration**: Full registration with admin approval workflow

### Feature Flags (Pending Admin Approval)
- **Text-to-Image**: Generate images from text prompts
- **Image-to-Image**: Transform images using AI
- **Text-to-Video**: Generate videos from text descriptions
- **Image-to-Video**: Create videos from images
- **Text-to-Sound**: Convert text to audio
- **Sound-to-Text**: Transcribe audio to text

## Tech Stack

### Free & Scalable Architecture

| Layer | Technology | Free Tier | Scale-Up Path |
|-------|------------|-----------|---------------|
| **Frontend** | React + Vite + TailwindCSS | ✅ Free | Vercel/Netlify |
| **Backend** | Node.js + Express | ✅ Free | Railway/Render |
| **Database** | MongoDB Atlas | ✅ 512MB Free | MongoDB Cloud |
| **Auth** | Firebase Auth | ✅ Free | Firebase Blaze |
| **Hosting** | Local/Hostinger | ✅ Free | Paid VPS |

### Alternative Stack Options

For scale-up, consider:
- **Backend**: Supabase, Railway, Render, Fly.io
- **Database**: PostgreSQL on Supabase, PlanetScale
- **Auth**: Clerk, Auth0, Magic Link

## Quick Start

```bash
# Clone & setup
git clone https://github.com/Faber-Aritonang/ai-multimodal-app.git
cd ai-multimodal-app

# Backend
cd backend
npm install
cp .env.example .env
# Edit .env with your configuration
npm run dev

# Frontend
cd ../frontend
npm install
npm run dev
```

Visit `http://localhost:3000` (backend) and `http://localhost:5173` (frontend)

## Backend Setup

### 1. Install Dependencies
```bash
cd backend
npm install
```

### 2. Environment Variables
Copy `.env.example` to `.env` and configure:

```bash
# Server
PORT=3000
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/db-name
JWT_SECRET=your-super-secret-key-here

# Firebase (for Auth)
FIREBASE_SERVICE_ACCOUNT=./config/firebase-service-account.json

# AI APIs (for future features)
OPENAI_API_KEY=sk-your-key
ELEVENLABS_API_KEY=your-key
HUGGINGFACE_API_KEY=hf-your-key
```

### 3. Firebase Setup

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project
3. Enable Google Sign-in in Authentication
4. Download service account key: Project Settings → Service accounts → Generate new private key
5. Place it at `./config/firebase-service-account.json`

### 4. MongoDB Setup

Option A: MongoDB Atlas (Free Tier)
1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Create a free cluster
3. Get connection string
4. Add to `MONGODB_URI`

Option B: Local MongoDB
```bash
npm install -g mongod
mongod --port 27017
```

## Frontend Setup

### 1. Install Dependencies
```bash
cd frontend
npm install
```

### 2. Firebase Configuration

Edit `src/config/firebase.js`:

```javascript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

Get these from your Firebase project settings.

### 3. Run Development Server
```bash
npm run dev
```

Visit `http://localhost:5173`

## API Documentation

### Auth Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/api/v1/auth/register` | Register new user (creates pending member) | ❌ No |
| POST | `/api/v1/auth/login` | Login with Firebase token | ❌ No |
| GET | `/api/v1/auth/status` | Check authentication status | ✅ Optional |
| POST | `/api/v1/auth/logout` | Logout user | ✅ Optional |

### Member Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/v1/member/profile` | Get user profile | ✅ Member |
| GET | `/api/v1/member/quota` | Get user quotas | ✅ Member |
| GET | `/api/v1/member/chat/sessions` | List chat sessions | ✅ Member |
| POST | `/api/v1/member/chat/sessions` | Create new chat session | ✅ Member |
| POST | `/api/v1/member/chat/sessions/:sessionId/message` | Send message | ✅ Member |
| GET | `/api/v1/member/chat/sessions/:sessionId` | Get session details | ✅ Member |
| DELETE | `/api/v1/member/chat/sessions/:sessionId` | Delete session | ✅ Member |

### Admin Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/v1/admin/pending-members` | List pending members | ✅ Admin |
| GET | `/api/v1/admin/approved-members` | List approved members | ✅ Admin |
| PUT | `/api/v1/admin/approve-member/:uid` | Approve member | ✅ Admin |
| DELETE | `/api/v1/admin/reject-member/:uid` | Reject member | ✅ Admin |
| GET | `/api/v1/admin/analytics` | Get analytics | ✅ Admin |

## Example API Usage

### Register User
```bash
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "firebaseToken": "user-firebase-id-token",
    "displayName": "John Doe",
    "email": "john@example.com"
  }'
```

### Get Auth Status
```bash
curl -X GET http://localhost:3000/api/v1/auth/status \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Send Chat Message
```bash
curl -X POST http://localhost:3000/api/v1/member/chat/sessions/xxx/message \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello AI!"}'
```

## Deployment

### Backend Deployment (Railway)

1. Push backend to GitHub:
```bash
cd backend
git init
git add .
git commit -m "Initial commit"
git push origin main
```

2. Go to [Railway.app](https://railway.app)
3. Create new project → Deploy from GitHub
4. Set environment variables in Railway dashboard
5. Deploy!

### Frontend Deployment (Vercel)

1. Push frontend to GitHub:
```bash
cd frontend
git init
git add .
git commit -m "Initial commit"
git push origin main
```

2. Go to [Vercel.com](https://vercel.com)
3. Create new project → Import from GitHub
4. Configure project settings
5. Deploy!

### Environment Variables for Production

**Backend (.env)**:
```
NODE_ENV=production
PORT=3000
MONGODB_URI=your-mongodb-connection-string
JWT_SECRET=production-secret-key
FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}
OPENAI_API_KEY=your-openai-key
```

**Frontend**: Set in Vercel dashboard:
```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
...
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (React)                         │
│  ┌─────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │   Login     │───▶│ LoginPage    │───▶│ HomePage     │  │
│  │  Register   │───▶│ RegisterPage │───▶│ Dashboard    │  │
│  │             │───▶│ ChatPage     │───▶│ Profile      │  │
│  └─────────────┘    └──────────────┘    └──────────────┘  │
│           │                       │                       │
│           ▼                       ▼                       │
│  Firebase Auth     Axios (JWT token)                        │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                     Backend (Express)                       │
│  ┌─────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │   Auth      │───▶│ auth.js      │───▶│ authCtrl     │  │
│  │   Member    │───▶│ member.js    │───▶│ chatCtrl     │  │
│  │   Admin     │───▶│ admin.js     │───▶│ adminCtrl    │  │
│  └─────────────┘    └──────────────┘    └──────────────┘  │
│                                                  │        │
│  Middleware: auth.js, rateLimit, helmet           │        │
│                                                  ▼        │
│                                            MongoDB Atlas   │
└─────────────────────────────────────────────────────────────┘
```

## Project Structure

```
ai-multimodal-app/
├── backend/
│   ├── config/              # Configuration files
│   ├── controllers/         # Business logic
│   ├── middleware/          # Auth & validation middleware
│   ├── models/              # MongoDB schemas
│   ├── routes/              # API routes
│   ├── server.js            # Main entry point
│   └── package.json
│
├── frontend/
│   ├── public/              # Static assets
│   ├── src/
│   │   ├── components/      # Reusable components
│   │   ├── config/          # API & Firebase config
│   │   ├── pages/           # Page components
│   │   ├── App.jsx          # Router
│   │   └── main.jsx         # Entry point
│   └── package.json
│
└── README.md
```

## Future Improvements

### Phase 1: Core Features ✅
- [x] Backend scaffolding
- [x] MongoDB models
- [x] Auth middleware
- [x] Chat system
- [x] Frontend framework
- [x] UI components
- [x] Google authentication

### Phase 2: Media Features (Coming Soon)
- [ ] Text-to-Image (OpenAI DALL-E, Stable Diffusion)
- [ ] Image-to-Image
- [ ] Text-to-Video (RunwayML, Pika Labs)
- [ ] Image-to-Video
- [ ] Text-to-Sound (ElevenLabs)
- [ ] Sound-to-Text (Whisper)

### Phase 3: Enhancements
- [ ] File upload & storage (Firebase Storage/Cloudinary)
- [ ] Real-time chat (Socket.io)
- [ ] Admin dashboard with analytics
- [ ] User profile management
- [ ] Subscription plans
- [ ] Rate limiting per feature
- [ ] Caching (Redis)

## License

This project is licensed under the MIT License.

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## Contact

Project by [Faber-Aritonang](https://github.com/Faber-Aritonang)

---

**Note**: This is a work-in-progress project. Media generation features will be added in subsequent iterations.