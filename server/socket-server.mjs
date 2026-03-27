import http from "node:http";
import { Server } from "socket.io";

const port = Number(process.env.SOCKET_PORT ?? 4001);

const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("socket server ok");
});

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

io.on("connection", (socket) => {
  socket.on("room:join", ({ room }) => {
    if (typeof room === "string") socket.join(room);
  });

  socket.on("room:leave", ({ room }) => {
    if (typeof room === "string") socket.leave(room);
  });

  socket.on("message:created", (payload) => {
    const room = typeof payload?.chatId === "string" ? `chat:${payload.chatId}` : null;
    if (!room) return;
    // Broadcast to everyone except the sender (prevents local duplicates)
    socket.to(room).emit("message:created", payload);
  });
});

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Socket.IO server listening on :${port}`);
});

