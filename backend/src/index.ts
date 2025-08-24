import express from 'express';
import http from 'http';
import WebSocket from 'ws';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { initializeDatabase, createTables } from './utils/database';
import { initializeRedis } from './utils/redis';

// Load environment variables
dotenv.config();

// Create Express app
const app = express();
const server = http.createServer(app);

// WebSocket server
const wss = new WebSocket.Server({ server });

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

// Import routes
import authRoutes from './routes/auth';
import reportRoutes from './routes/reports';
import blockRoutes from './routes/blocks';
import balanceRoutes from './routes/balances';

// Use routes
app.use('/auth', authRoutes);
app.use('/reports', reportRoutes);
app.use('/blocks', blockRoutes);
app.use('/balances', balanceRoutes);

// WebSocket connection handling
wss.on('connection', (ws: WebSocket, req) => {
  console.log('New WebSocket connection');
  
  // Handle incoming messages
  ws.on('message', (message: string) => {
    try {
      const data = JSON.parse(message);
      handleWebSocketMessage(ws, data);
    } catch (error) {
      console.error('Error parsing WebSocket message:', error);
      ws.send(JSON.stringify({ error: 'Invalid message format' }));
    }
  });
  
  // Handle connection close
  ws.on('close', () => {
    console.log('WebSocket connection closed');
  });
  
  // Handle errors
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Handle WebSocket messages
const handleWebSocketMessage = (ws: WebSocket, data: any) => {
  switch (data.type) {
    case 'joinQueue':
      // Handle joining queue
      handleJoinQueue(ws, data);
      break;
    case 'signal':
      // Handle WebRTC signaling
      handleSignal(ws, data);
      break;
    case 'leave':
      // Handle leaving session
      handleLeave(ws, data);
      break;
    default:
      ws.send(JSON.stringify({ error: 'Unknown message type' }));
  }
};

// Handle joining queue
const handleJoinQueue = (ws: WebSocket, data: any) => {
  // In a real implementation, this would:
  // 1. Validate the user's JWT
  // 2. Add the user to the Redis queue for the specified chain
  // 3. Check for matches and notify both users when found
  
  console.log('User joining queue:', data);
  
  // For demo purposes, we'll just send a response
  ws.send(JSON.stringify({
    type: 'queueStatus',
    position: 1,
    estimatedWait: 30 // seconds
  }));
};

// Handle WebRTC signaling
const handleSignal = (ws: WebSocket, data: any) => {
  // In a real implementation, this would:
  // 1. Validate the user's JWT
  // 2. Forward the signaling data to the peer
  
  console.log('Signaling message:', data);
  
  // For demo purposes, we'll just echo it back
  ws.send(JSON.stringify({
    type: 'signal',
    data: data.data
  }));
};

// Handle leaving session
const handleLeave = (ws: WebSocket, data: any) => {
  // In a real implementation, this would:
  // 1. Validate the user's JWT
  // 2. Remove the user from any queues or active sessions
  // 3. Notify the peer if in a session
  
  console.log('User leaving session:', data);
  
  // For demo purposes, we'll just send a response
  ws.send(JSON.stringify({
    type: 'sessionEnded'
  }));
};

// Initialize database and Redis
const initializeServices = async () => {
  await initializeDatabase();
  await createTables();
  await initializeRedis();
};

// Initialize services and start server
initializeServices().then(() => {
  const PORT = process.env.PORT || 3001;
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}).catch((error) => {
  console.error('Failed to initialize services:', error);
  process.exit(1);
});
