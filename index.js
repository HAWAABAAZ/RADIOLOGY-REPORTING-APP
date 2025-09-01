import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Placeholder endpoints
app.post('/api/generate-report', async (req, res) => {
  res.json({ 
    success: true, 
    message: 'Report generation endpoint - integrate your AI service here' 
  });
});

app.post('/api/transcribe', async (req, res) => {
  res.json({ 
    success: true, 
    message: 'Transcription endpoint - integrate your transcription service here' 
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;
