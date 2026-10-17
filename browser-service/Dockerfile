FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
COPY browser-service/package.json browser-service/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY browser-service/server.mjs browser-service/security.mjs ./
COPY lib/reporting.mjs ./reporting.mjs
COPY public/core.mjs public/evaluations.mjs ./
RUN sed -i "s|../public/core.mjs|./core.mjs|" reporting.mjs && chown -R pwuser:pwuser /app
USER pwuser
ENV NODE_ENV=production
EXPOSE 10000
CMD ["node","server.mjs"]
