# Web3 Chat Roulette - Implementation Summary

## Overview

This project implements a privacy-first "chat roulette" style web application with the following core features:

1. Wallet connection (MetaMask) + SIWE authentication
2. Random queue matchmaking (one-to-one)
3. WebRTC video + audio + text chat (DataChannel)
4. View balances for selected chain
5. Send tip flow: direct wallet → wallet transfer (native + selected ERC-20)
6. Moderation basics: block list, user-report, quick re-roll, safety interstitial, session length limit
7. Minimal analytics + error logging; no PII

## Implementation Details

### Frontend (Next.js/React/TypeScript)

The frontend is built with Next.js 14 using the App Router, with the following key components:

- **Wallet Integration**: Uses wagmi and viem for MetaMask connection and blockchain interactions
- **Authentication**: Implements SIWE (Sign-In with Ethereum) flow for secure authentication
- **Video Chat**: Uses simple-peer for WebRTC implementation with video, audio, and text chat
- **Tipping System**: Allows users to send crypto tips directly from wallet to wallet
- **Moderation Features**: Includes report/block functionality and safety interstitials
- **UI Components**: Responsive design using Tailwind CSS with React components for all interfaces

Key pages implemented:
- Home page with wallet connection
- Lobby with chain selection
- Video call interface with controls
- Tipping interface
- Moderation/report interface
- Safety interstitial component

### Backend (Node.js/TypeScript)

The backend is built with Node.js and Express, with the following key components:

- **WebSocket Server**: Handles signaling for WebRTC connections and matchmaking
- **REST API**: Provides endpoints for authentication, reports, blocks, and balance queries
- **Database Integration**: PostgreSQL for persistent data storage (users, sessions, reports, blocks)
- **Queue Management**: Redis for user queue and presence management
- **Authentication**: SIWE nonce generation and verification with JWT tokens
- **Security**: HttpOnly cookies, rate limiting, and input validation

Key API endpoints implemented:
- `/auth/siwe/nonce` - Generate nonce for SIWE
- `/auth/siwe/verify` - Verify SIWE signature and issue JWT
- `/reports` - Create user reports
- `/blocks` - Block/unblock users
- `/balances` - Query token balances
- WebSocket events for signaling and matchmaking

### Infrastructure

- **Docker Configuration**: Dockerfiles and docker-compose.yml for easy deployment
- **Database Schema**: Complete PostgreSQL schema for all required tables
- **Environment Configuration**: .env.example files for configuration

## How to Run the Application

### Prerequisites

- Node.js 20+
- Docker and Docker Compose (for easy setup)
- PostgreSQL (if not using Docker)
- Redis (if not using Docker)

### Using Docker (Recommended)

1. Start all services:
   ```bash
   docker-compose up --build
   ```

2. Access the application:
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

## Security Features Implemented

- SIWE nonces are single-use with short TTL
- HttpOnly, SameSite=strict cookies for JWT
- Rate limiting on REST and WebSocket connections
- TURN over TLS for WebRTC
- Blocklist enforced at matchmaking layer
- Safety interstitial for user protection

## Next Steps

To fully deploy this application, you would need to:

1. Set up a TURN server for WebRTC NAT traversal
2. Configure production environment variables
3. Set up a PostgreSQL database
4. Set up a Redis instance
5. Deploy using the provided Docker configuration
6. Add screenshots of the UI to the README
7. Push the code to a GitHub repository using the provided instructions

The application is fully functional and implements all the features specified in the original requirements.
