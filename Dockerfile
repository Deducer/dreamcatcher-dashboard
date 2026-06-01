# Node 22 (not 20): @supabase/supabase-js >=2.x realtime requires native
# WebSocket, which only exists in Node 22+. On Node 20 createClient() throws
# "Node.js 20 detected without native WebSocket support" and the app crashes.
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
