import express from "express";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Server } from "socket.io";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { availableParallelism } from "node:os";
import cluster from "node:cluster";

const app = express();
const server = createServer(app);
const io = new Server(server);
const __dirname = dirname(fileURLToPath(import.meta.url));

let isSignedIn = false;

if (cluster.isPrimary) {
  const numCPUs = availableParallelism();
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork({
      PORT: 3000 + i,
    });
  }
} else {
  const port = process.env.PORT;
  server.listen(port, () => {
    console.log(`server running at http://localhost:${port}`);
  });
}
const db = await open({
  filename: "app.db",
  driver: sqlite3.Database,
});

await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_offset TEXT UNIQUE,
      username TEXT,
      password TEXT
    );
  `);

await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_offset TEXT,
      content TEXT,
      sender TEXT,
      receiver TEXT
    );
  `);

await db.exec(`
  CREATE TABLE IF NOT EXISTS receivers (
    receiver TEXT
)`);

await db.exec(`
  CREATE TABLE IF NOT EXISTS senders (
    sender TEXT
)`);

await db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_offset TEXT UNIQUE,
      roomname TEXT,
      password TEXT
    );
  `);

await db.exec(`
    CREATE TABLE IF NOT EXISTS roommessages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_offset TEXT,
      content TEXT,
      sender TEXT,
      receiver TEXT
    );
  `);

app.get("/", (req, res) => {
  res.redirect(isSignedIn ? "/chatroom" : "/users");
});

app.get("/welcome", (req, res) => {
  res.sendFile(join(__dirname, "pages/welcome.html"));
});
app.get("/signup", (req, res) => {
  res.sendFile(join(__dirname, "pages/signup.html"));
});
app.get("/login", (req, res) => {
  res.sendFile(join(__dirname, "pages/login.html"));
});
app.get("/users", (req, res) => {
  res.sendFile(join(__dirname, "pages/users.html"));
});
app.get("/chat", (req, res) => {
  res.sendFile(join(__dirname, "pages/one-on-one-chat.html"));
});
app.get("/room", (req, res) => {
  res.sendFile(join(__dirname, "pages/room-chat.html"));
});
app.get("/createroom", (req, res) => {
  res.sendFile(join(__dirname, "pages/create-room.html"));
});

app.post("/signin", (req, res) => {
  isSignedIn = true;
  console.log("hello", isSignedIn);
});

io.on("connection", async (socket) => {
  socket.on("username", async (user, password, clientOffset, callback) => {
    try {
      let result = await db.get("SELECT * FROM users WHERE username = ?", user);
      if (result) {
        // If a result is found, emit 'userexists' event
        socket.emit(
          "userexists",
          `<div class='flex flex-row'>User with name '${user}' already exists</div><br/> 
    <a class='text-xl px-5 py-3 rounded-lg border-2 border-[#ee3156] text-[#ee3156]' href='/signup'>use another name</a><br/>
        <p class='mt-10 text-xl'>already a user</p><br/>
    <a class='text-xl px-20 py-3 rounded-lg bg-[#ee3156] text-white' href='/login'>Log In</a>
    `,
        );
      } else {
        let result;
        result = await db.run(
          "INSERT INTO users (username,password, client_offset) VALUES (?,?, ?)",
          user,
          password,
          clientOffset,
        );
        io.emit("username", user, password, result.lastID);
        callback();
      }
    } catch (error) {
      console.error("Error checking client offset:", error);
    }
  });

  socket.on("login", async (user, password, clientOffset, callback) => {
    let result = await db.get(
      "SELECT * FROM users WHERE username = ? AND password = ?",
      user,
      password,
    );
    if (result) {
      result = await db.run(
        "INSERT INTO users (username, client_offset) VALUES (?, ?)",
        user,
        password,
        clientOffset,
      );
      io.emit("login", user, password, result.lastID);
      callback();
    } else {
      // If a result is not found, emit 'usernotexists' event
      socket.emit(
        "usernotexists",
        `<div class='flex flex-row'>username or password are wrong</div><br/> 
    <a class='text-xl px-5 py-3 rounded-lg border-2 border-[#ee3156] text-[#ee3156]' href='/login'>try again</a><br/>
        <p class='mt-10 text-xl'>don't have account</p><br/>
    <a class='text-xl px-20 py-3 rounded-lg bg-[#ee3156] text-white' href='/login'>Sign In</a>
    `,
      );
    }
  });
  socket.on(
    "chat message",
    async (clientOffset, msg, sender, receiver, callback) => {
      console.log("Received message:", msg, "From:", sender, "To:", receiver);
      try {
        let result = await db.run(
          "INSERT INTO messages (client_offset, content, sender, receiver) VALUES (?, ?, ?, ?)",
          clientOffset,
          msg,
          sender,
          receiver,
        );
        io.emit("chat message", result.lastID, msg, sender, receiver);
        callback();
      } catch (error) {
        console.error("Error inserting message:", error);
        callback(error);
      }
    },
  );
  socket.on("receiver", async (receiver, callback) => {
    let result = await db.run(
      "INSERT INTO receivers (receiver) VALUES (?)",
      receiver,
    );
    io.emit("receiver", receiver);
    callback();
  });
  socket.on("sender", async (sender, callback) => {
    let result = await db.run(
      "INSERT INTO senders (sender) VALUES (?)",
      sender,
    );
    io.emit("sender", sender);
    callback();
  });
  socket.on("roomname", async (room, password, clientOffset, callback) => {
    try {
      let result = await db.get("SELECT * FROM rooms WHERE roomname = ?", room);
      if (result) {
        // If a result is found, emit 'roomexists' event
        socket.emit(
          "roomexists",
          `<div class='flex flex-row'>room with name '${room}' already exists</div><br/> 
    <a class='text-xl px-5 py-3 rounded-lg border-2 border-[#ee3156] text-[#ee3156]' href='/createroom'>use another name</a><br/>
        <p class='mt-10 text-xl'>or just use the existing room</p><br/>
    <a class='text-xl px-20 py-3 rounded-lg bg-[#ee3156] text-white' href='/users'>Rooms</a>
    `,
        );
      } else {
        let result;
        result = await db.run(
          "INSERT INTO rooms (roomname,password, client_offset) VALUES (?,?, ?)",
          room,
          password,
          clientOffset,
        );
        io.emit("roomname", room, password, result.lastID);
        callback();
      }
    } catch (error) {
      console.error("Error checking client offset:", error);
    }
  });
  socket.on(
    "room message",
    async (clientOffset, msg, sender, receiver, callback) => {
      console.log("Received message:", msg, "From:", sender, "To:", receiver);
      try {
        let result = await db.run(
          "INSERT INTO messages (client_offset, content, sender, receiver) VALUES (?, ?, ?, ?)",
          clientOffset,
          msg,
          sender,
          receiver,
        );
        io.emit("room message", result.lastID, msg, sender, receiver);
        callback();
      } catch (error) {
        console.error("Error inserting message:", error);
        callback(error);
      }
    },
  );
  if (!socket.recovered) {
    try {
      await db.each(
        "SELECT * FROM users WHERE id > ?",
        [socket.handshake.auth.serverOffset || 0],
        (_err, row) => {
          socket.emit("username", row.username, row.password, row.id);
        },
      );

      db.each(
        "SELECT * FROM messages WHERE id > ?",
        [socket.handshake.auth.serverOffset || 0],
        (_err, row) => {
          socket.emit(
            "chat message",
            row.id,
            row.content,
            row.sender,
            row.receiver,
          );
        },
      );

      db.each("SELECT receiver FROM receivers", (_err, row) => {
        socket.emit("receiver", row.receiver);
      });
      db.each("SELECT sender FROM senders", (_err, row) => {
        socket.emit("sender", row.sender);
      });

      db.each(
        "SELECT * FROM rooms WHERE id > ?",
        [socket.handshake.auth.serverOffset || 0],
        (_err, row) => {
          socket.emit("roomname", row.roomname, row.password, row.id);
        },
      );

      db.each(
        "SELECT * FROM roommessages WHERE id > ?",
        [socket.handshake.auth.serverOffset || 0],
        (_err, row) => {
          socket.emit(
            "room message",
            row.id,
            row.content,
            row.sender,
            row.receiver,
          );
        },
      );
    } catch (e) {}
  }
});
