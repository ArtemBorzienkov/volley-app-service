FROM node:16

# Create app directory
WORKDIR /usr/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY package*.json ./
COPY prisma ./prisma/

RUN npm install
RUN npx prisma generate
# If you are building your code for production
# RUN npm ci --only=production

# Bundle app source
COPY . .
WORKDIR /usr/app/src

EXPOSE 3000
CMD [ "npm", "run", "start" ]