# Node Assignment

This is a Node.js project for managing users, groups, and messages. It uses Express and includes authentication and error handling middleware.

## Project Structure

```
├── env.sample
├── error.log
├── package.json
├── README.md
├── server.js
├── middleware/
│   ├── auth.js
│   └── errorHandler.js
├── models/
│   ├── Group.js
│   ├── Message.js
│   └── User.js
├── routes/
│   ├── auth.js
│   ├── groups.js
│   └── messages.js
```

## Getting Started

### Prerequisites

### Installation

1. Clone the repository:
   ```zsh
   git clone <repo-url>
   cd node-assignment
   ```
2. Install dependencies:
   ```zsh
   npm install
   ```
3. Copy the sample environment file and update it with your configuration:
   ```zsh
   cp env.sample .env
   # Edit .env with your preferred settings
   ```

#### Example .env file

```env
# Environment variables for Assignment_Project
PORT=
NODE_ENV=
MONGODB_URI=
LOG_LEVEL=
JWT_SECRET=
ENCRYPTION_KEY=
```

### Running the Server

Start the server with:

```zsh
npm start
```

Or, if you want to run in development mode (with auto-reload):

```zsh
npm run dev
```

The server will start on the port specified in your `.env` file (default is usually 3000).

## API Documentation

Swagger UI is available at `/api-docs` for interactive API documentation.

## API Documentation

Swagger UI is available at `/api-docs` for interactive API documentation.

## Middleware

- `middleware/auth.js` - Handles authentication
- `middleware/errorHandler.js` - Handles errors globally

## Models

- `models/User.js` - User schema/model
- `models/Group.js` - Group schema/model
- `models/Message.js` - Message schema/model

## Logging

Errors are logged to `error.log`.

## Contributing

Feel free to fork and submit pull requests.

## License

MIT
