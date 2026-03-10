FROM node:22-alpine

WORKDIR /app

COPY server.js index.html style.css app.js ./

EXPOSE 3000

USER node

CMD ["node", "server.js"]
