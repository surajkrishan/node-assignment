// server.js
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const winston = require("winston");
const http = require("http");
const socketIO = require("socket.io");
const swaggerUi = require("swagger-ui-express");
const swaggerJsdoc = require("swagger-jsdoc");

// Import routes
const authRoutes = require("./routes/auth");
const groupRoutes = require("./routes/groups");
const messageRoutes = require("./routes/messages");

// Import middleware
const authMiddleware = require("./middleware/auth");
const errorHandler = require("./middleware/errorHandler");

// Load environment variables
dotenv.config();

// Configure winston logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
    new winston.transports.File({ filename: "error.log", level: "error" }),
    new winston.transports.File({ filename: "combined.log" }),
  ],
});

// Initialize Express app
const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: process.env.CLIENT_URL || "*",
    methods: ["GET", "POST"],
  },
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Swagger setup
const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Group Messaging API",
      version: "1.0.0",
      description: "API documentation for Group Messaging App",
    },
    servers: [
      {
        url: `/api`,
        description: "API server",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ["./routes/auth.js", "./routes/groups.js", "./routes/messages.js"],
};
const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    body: req.body,
    query: req.query,
    ip: req.ip,
  });
  next();
});

// MongoDB connection
mongoose
  .connect(
    process.env.MONGODB_URI || "mongodb://localhost:27017/group-messaging",
    {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    }
  )
  .then(() => logger.info("MongoDB connected successfully"))
  .catch((err) => {
    logger.error("MongoDB connection error:", err);
    process.exit(1);
  });

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/groups", authMiddleware, groupRoutes);
app.use("/api/messages", authMiddleware, messageRoutes);

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database:
      mongoose.connection.readyState === 1 ? "connected" : "disconnected",
  });
});

// ...existing code...

// WebSocket connection handling
io.on("connection", (socket) => {
  logger.info("New WebSocket connection:", socket.id);

  socket.on("join-group", (groupId) => {
    socket.join(groupId);
    logger.info(`Socket ${socket.id} joined group ${groupId}`);
  });

  socket.on("leave-group", (groupId) => {
    socket.leave(groupId);
    logger.info(`Socket ${socket.id} left group ${groupId}`);
  });

  socket.on("disconnect", () => {
    logger.info("WebSocket disconnected:", socket.id);
  });
});

// Make io accessible to routes
app.set("io", io);

// Error handling middleware (must be last)
app.use(errorHandler);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: "Not Found",
    message: `Cannot ${req.method} ${req.path}`,
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || "development"}`);
});
