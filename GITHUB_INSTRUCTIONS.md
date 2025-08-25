# How to Push This Project to a New GitHub Repository

## Prerequisites
1. A GitHub account
2. Git installed on your system

## Steps to Create and Push to a New Repository

1. **Create a new repository on GitHub:**
   - Go to https://github.com/new
   - Enter a repository name (e.g., "web3-chat-roulette")
   - Choose if it should be Public or Private
   - Do NOT initialize with a README, .gitignore, or license
   - Click "Create repository"

2. **Push the existing code to GitHub:**
   - Open a terminal in the project directory (`web3-chat-roulette`)
   - Run the following commands:
   ```bash
   # Add the remote origin (replace USERNAME with your GitHub username)
   git remote add origin https://github.com/USERNAME/web3-chat-roulette.git
   
   # Rename the default branch to main (if needed)
   git branch -M main
   
   # Push the code to GitHub
   git push -u origin main
   ```

3. **Verify the push:**
   - Visit your repository on GitHub
   - You should see all the files and folders from the project

## Additional Notes

The project includes:
- Frontend Next.js application in the `frontend/` directory
- Backend Node.js server in the `backend/` directory
- Docker configuration for easy deployment
- Comprehensive documentation in the README.md file

The application implements all the features specified in the original requirements:
- Wallet connection with MetaMask
- SIWE authentication
- WebRTC video chat
- Crypto tipping functionality
- Moderation features (report/block users)
- Safety interstitial component
