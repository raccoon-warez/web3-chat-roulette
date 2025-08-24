# Web3 Chat Roulette

A privacy-first "chat roulette" style web app where users connect a wallet (MetaMask or any EVM wallet), get randomly matched for a live video chat, and can tip/send crypto to the peer during the session.

## Features

- Wallet connection (MetaMask) + SIWE auth
- Random queue matchmaking (one-to-one)
- WebRTC video + audio + text chat (DataChannel)
- View balances for selected chain
- Send tip flow: direct wallet → wallet transfer (native + selected ERC-20)
- Moderation basics: block list, user-report, quick re-roll, safety interstitial, session length limit
- Minimal analytics + error logging; no PII

## Tech Stack

### Frontend
- Next.js 14
- React 18
- TypeScript
- Tailwind CSS
- wagmi + viem for wallet interactions
- simple-peer for WebRTC

### Backend
- Node.js 20
- Express.js
- WebSocket for signaling
- PostgreSQL for persistent data
- Redis for queue and presence
- SIWE for authentication

## Prerequisites

- Node.js 20+
- Docker and Docker Compose (for easy setup)
- PostgreSQL (if not using Docker)
- Redis (if not using Docker)

## Getting Started

### Using Docker (Recommended)

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd web3-chat-roulette
   ```

2. Start all services:
   ```bash
   docker-compose up --build
   ```

3. Access the application:
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:3001

### Manual Setup

#### Backend

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file based on `.env.example`:
   ```bash
   cp .env.example .env
   # Edit .env with your actual values
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```

#### Frontend

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Access the application at http://localhost:3000

## Project Structure

```
web3-chat-roulette/
├── frontend/              # Next.js frontend application
│   ├── app/               # App router pages
│   ├── components/        # React components
│   ├── lib/               # Library files (wagmi config, etc.)
│   └── public/            # Static assets
├── backend/               # Node.js backend server
│   ├── src/
│   │   ├── routes/        # API routes
│   │   ├── middleware/    # Express middleware
│   │   ├── utils/         # Utility functions
│   │   └── index.ts       # Main server file
│   ├── .env.example       # Environment variables example
│   └── Dockerfile         # Docker configuration
├── docker-compose.yml     # Docker Compose configuration
└── README.md              # This file
```

## API Endpoints

### Authentication
- `GET /auth/siwe/nonce` - Generate a nonce for SIWE
- `POST /auth/siwe/verify` - Verify SIWE signature

### Reports
- `POST /reports` - Create a new report

### Blocks
- `POST /blocks` - Block a user
- `GET /blocks` - Get user's block list

### Balances
- `GET /balances` - Get user's token balances

### WebSocket Events
- `joinQueue({ chainId, prefs })` - Join the matchmaking queue
- `match({ sessionId, peerAddress })` - Match found notification
- `signal({ sessionId, sdp/ice })` - WebRTC signaling data
- `leave({ sessionId })` - Leave session

## Development

### Environment Variables

Create `.env` files in both `frontend/` and `backend/` directories with the required environment variables.

### Testing

Run tests with:
```bash
# Frontend tests
cd frontend
npm run test

# Backend tests
cd backend
npm run test
```

## Deployment

The application can be deployed using Docker containers. Update the `docker-compose.yml` file with production-specific configurations before deployment.

## Security Considerations

- SIWE nonces are single-use with short TTL
- HttpOnly, SameSite=strict cookies for JWT
- Rate limiting on REST and WebSocket connections
- TURN over TLS for WebRTC
- Blocklist enforced at matchmaking layer

## License

MIT
