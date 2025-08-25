#!/usr/bin/env node

/**
 * Scaling Server Starter
 * 
 * This script starts the Web3 Chat Roulette application with scaling capabilities
 * It handles environment setup and graceful error handling
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Check if TypeScript is built
const distPath = path.join(__dirname, 'dist');
if (!fs.existsSync(distPath)) {
  console.log('📦 Building TypeScript files...');
  
  const buildProcess = spawn('npm', ['run', 'build'], { stdio: 'inherit' });
  buildProcess.on('exit', (code) => {
    if (code === 0) {
      startScalingServer();
    } else {
      console.error('❌ Build failed. Starting with basic configuration...');
      startBasicServer();
    }
  });
} else {
  startScalingServer();
}

function startScalingServer() {
  console.log('🚀 Starting Web3 Chat Roulette with Scaling Architecture...');
  
  // Set scaling environment variables
  process.env.CLUSTER_ENABLED = process.env.CLUSTER_ENABLED || 'true';
  process.env.MONITORING_ENABLED = process.env.MONITORING_ENABLED || 'true';
  process.env.HEALTH_CHECKS_ENABLED = process.env.HEALTH_CHECKS_ENABLED || 'true';
  process.env.METRICS_ENABLED = process.env.METRICS_ENABLED || 'true';
  
  const serverPath = path.join(distPath, 'scaling', 'scaling-server.js');
  
  if (fs.existsSync(serverPath)) {
    const server = spawn('node', [serverPath], { 
      stdio: 'inherit',
      env: { ...process.env }
    });
    
    server.on('exit', (code) => {
      if (code !== 0) {
        console.log('⚠️  Scaling server exited, falling back to basic server...');
        startBasicServer();
      }
    });
  } else {
    console.log('⚠️  Scaling server not found, using basic server...');
    startBasicServer();
  }
}

function startBasicServer() {
  console.log('🔧 Starting basic server configuration...');
  
  const basicServerPath = path.join(distPath, 'index.js');
  
  if (fs.existsSync(basicServerPath)) {
    spawn('node', [basicServerPath], { stdio: 'inherit' });
  } else {
    console.error('❌ No server files found. Please run npm run build first.');
    process.exit(1);
  }
}

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down...');
  process.exit(0);
});