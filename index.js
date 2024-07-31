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

let signedIn = false;

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
      username TEXT
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

app.get("/", (req, res) => {
  if (signedIn) {
    res.redirect("/chatroom");
  } else {
    res.redirect("/chatroom");
  }
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
app.get("/chatroom", (req, res) => {
  res.sendFile(join(__dirname, "pages/chatroom.html"));
});

io.on("connection", async (socket) => {
  socket.on("username", async (user, clientOffset, callback) => {
    try {
      let result = await db.get("SELECT * FROM users WHERE username = ?", user);
      if (result) {
        // If a result is found, emit 'userexists' event
        socket.emit(
          "userexists",
          `<p>User with name <p class='font-bold mx-2'> ${user}</p> already exists<br/> 
         <a href='/signup' class='text-[#ee3156]'>use another name</p>`,
        );
      } else {
        let result;
        result = await db.run(
          "INSERT INTO users (username, client_offset) VALUES (?, ?)",
          user,
          clientOffset,
        );
        io.emit("username", user, result.lastID);
        callback();
      }
    } catch (error) {
      console.error("Error checking client offset:", error);
    }
  });

  socket.on("login", async (user, clientOffset, callback) => {
    let result;
        result = await db.run(
          "INSERT INTO users (username, client_offset) VALUES (?, ?)",
          user,
          clientOffset,
        );
        io.emit("login", user, result.lastID);
        callback();
      })
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

  if (!socket.recovered) {
    try {
      await db.each(
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

      db.each(
        "SELECT id, username FROM users WHERE id > ?",
        [socket.handshake.auth.serverOffset || 0],
        (_err, row) => {
          socket.emit("username", row.username, row.id);
        },
      );
      db.each("SELECT receiver FROM receivers", (_err, row) => {
        socket.emit("receiver", row.receiver);
      });
      db.each("SELECT sender FROM senders", (_err, row) => {
        socket.emit("sender", row.sender);
      });
    } catch (e) {}
  }
});
