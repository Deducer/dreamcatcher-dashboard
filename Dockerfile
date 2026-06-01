# Node 22 (not 20): @supabase/supabase-js >=2.x realtime requires native
# WebSocket, which only exists in Node 22+. On Node 20 createClient() throws
# "Node.js 20 detected without native WebSocket support" and the app crashes.
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
# npm ci (not npm install): installs the exact versions pinned in
# package-lock.json so a transitive dependency can't silently drift on
# rebuild and break the deploy (which is how the Node-20/WebSocket crash got
# introduced). Lockfile changes must be committed for this to pick them up.
RUN npm ci --omit=dev

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
