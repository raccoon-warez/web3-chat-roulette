# Use Node.js 20 as the base image
FROM node:20-alpine

# Set the working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy the rest of the application code
COPY . .

# Build the Next.js application
RUN npm run build

# Expose the port the app runs on
EXPOSE 3000

# Create a non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001

# Change ownership of the files to the non-root user
RUN chown -R nextjs:nodejs /app
USER nextjs

# Start the application
CMD ["npm", "start"]
