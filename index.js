const http = require("http");
const socketIO = require("socket.io");
const PORT = process.env.PORT || 4000;

//BACKEND :: HttpServer
const server = http.createServer(function (req, res) {
  //create web server
  if (req.url == "/") {
    //check the URL of the current request

    // set response header
    res.writeHead(200, { "Content-Type": "text/html" });
    // set response content
    res.write(
      '<html><body><p>This is home Page.</p><script src="http://localhost:4000/socket.io/socket.io.js"></script></body></html>'
    );
    res.end();
  } else if (req.url == "/admin") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.write(
      '<html><body><p>This is admin Page.</p><script src="http://localhost:4000/socket.io/socket.io.js"></script></body></html>'
    );
    res.end();
  } else res.end("Invalid Request!");
});

//UTIL FUNCTIONS

//Wrap SetTimeout in Timer so that we can Identity it
class Timer {
  constructor(callback, time) {
    this.timeId = setTimeout(callback, time);
  }
  clear() {
    clearTimeout(this.timeId);
  }
}

// const time = new Timer(() => console.log('hi'), 1000);
// console.log(time instanceof Timer);

//WEBSOCKET :: socket.io
const io = socketIO(server, {
  cors: {
    origins: "*:*",
  },
});

//Each SocketID is Mapped by crossponding {RoomId , username};
// Users.set(socketId, { roomId, username });
let Users = new Map();

//Rooms Hashed by RoomId && Contain GameBoard OBJ With Username
// Rooms.set(id, {
//   admin: socket.id,
//   users: [{username, id:socket.id, isReady:true , wazirPosition : [wazirPosition 1||2||3||4 ]} , undefined , { username, id, isReady, wazirPosition}],
//          PlayerData{[wazirPosition 1||2||3||4 ]} wazirPosition represents :: -1=> "Home" , 0-56=> "Jounrney" , 57=> "Win"
//   gameStatus: "LOBBY", gameStatusArray: ["LOBBY", "PLAYING", "ENDED"],
//   noOfPlayers: 0, currentPlayerIndex: -1, currentWazirIndex: -1,
//   hasRolledTheDice: false, hasExtraLife: false, isWazirMoving: false, stepsToTake: 0,
//   waitTime : In Sec
//   timerId: setTimeout Id to set per room, added dynamically For Backend Propose,
// });
let Rooms = new Map();

//addUser fnx Add User to Users and Rooms;
let addUser = (socket, roomId, username) => {
  let currentRoom = Rooms.get(roomId);
  let socketId = socket.id;

  Users.set(socketId, { roomId, username });
  socket.join(roomId);

  let leftUserIndex = currentRoom.users.findIndex((user) => user === undefined);
  let currentUser = {
    username,
    id: socketId,
    isReady: true,
    wazirPosition: [-1, -1, -1, -1],
  };

  if (leftUserIndex !== -1) {
    currentRoom.users[leftUserIndex] = currentUser;
  } else {
    currentRoom.users.push(currentUser);
  }
  currentRoom.noOfPlayers++;
  io.to(roomId).emit("newPlayer", currentRoom.users);
};

//removeUser fnx Remove Users
//if Its the Last User in the Room it deletes the Room;
let removeUser = (socket, gameCompleted = false) => {
  let { roomId, username } = Users.get(socket.id);
  Users.delete(socket.id);
  let currentRoom = Rooms.get(roomId);

  if (currentRoom.noOfPlayers === 1) {
    Rooms.delete(roomId);
    console.log(`Room ${roomId} is delete`);
    socket.leave(roomId);
    return;
  }

  let removedUserIndex = currentRoom.users.findIndex((user) =>
    user === undefined ? false : user.id === socket.id
  );

  if (removedUserIndex === -1) {
    console.log("SOMETHING BAD HAPPEN WHILE REMOVING USER");
    return;
  }
  currentRoom.users[removedUserIndex] = gameCompleted ? "Win" : undefined;
  currentRoom.noOfPlayers--;
  socket.leave(roomId);
  io.to(roomId).emit("playerLeft", username, socket.id);
};

//return true if user is present in the room
let checkRoom = (roomId, socket) => {
  //if Room doesn't Exist Emit Failure
  if (socket.adapter.rooms.has(roomId) || Rooms.has(roomId)) return true;
  socket.emit("log", `No room with this ${roomId} Room Id `);
  return false;
};

// let rollTheDice = (roomId, userId) => {
//   let diceNumber = (Math.ceil(Math.random() * 6) % 6) + 1;
//   io.to(roomId).emit("steps", userId, diceNumber);
//   return diceNumber;
// };

let playerTurn = (roomId, socketId) => {
  let currentRoom = Rooms.get(roomId);
  currentRoom.currentPlayerId = socketId;
  io.to(roomId).emit("turn", socketId);
  currentRoom.rollTimerId = new Timer(() => {
    rollTheDice(roomId, socketId);
  }, currentRoom.waitTime * 1000);
};

let rollTheDice = (roomId, userId) => {
  let currentRoom = Rooms.get(roomId);
  if (!currentRoom) return;

  if (currentRoom.hasRolledTheDice) {
    io.to(roomId).emit("log", "can't rolled dice again");
    return;
  }

  if (currentRoom.isWazirMoving) {
    io.to(roomId).emit("log", "wazir is already moving");
    return;
  }

  if (currentRoom.currentPlayerId !== userId) {
    io.to(roomId).emit(
      "log",
      `${userId} you can't roll the Dice, ${currentRoom.currentPlayerId} has turn to roll the dice`
    );
    return;
  }
  currentRoom.rollTimerId.clear();
  currentRoom.hasRolledTheDice = true;
  let diceNumber = (Math.ceil(Math.random() * 6) % 6) + 1;
  if (diceNumber === 6) currentRoom.hasExtraLife = true;
  currentRoom.stepsToTake = diceNumber;
  io.to(roomId).emit("steps", userId, diceNumber);
  console.log(`Rolled Dice :: ${diceNumber} ${userId}`);

  let currentUser = currentRoom.users.find((user) => {
    if (user && user.id === userId) return true;
  });

  if (!currentUser) {
    //@TODO current Has left the game, remove the user from the room
    io.to(roomId).emit("log", `Maybe ${userId} has left the game`);
    nextPlayer(roomId);
    return;
  }

  let wazirThatCanMove = currentUser.wazirPosition
    .map((wazirPosIndex, index) => {
      if (wazirPosIndex === -1 && diceNumber === 6) return index;
      if (wazirPosIndex > -1 && wazirPosIndex + diceNumber <= 57) return index;
    })
    .filter((wazirPosIndex) => wazirPosIndex !== undefined);

  if (wazirThatCanMove === undefined || wazirThatCanMove.length === 0) {
    io.to(roomId).emit("log", "backend called the Next Player");
    setTimeout(() => nextPlayer(roomId), 1 * 500);
    return;
  }

  currentRoom.nonBoundedWazir = [...wazirThatCanMove];
  console.log(currentUser.wazirPosition, currentRoom.nonBoundedWazir);

  if (wazirThatCanMove.length === 1) {
    io.to(roomId).emit("log", "backend called the single wazir");
    currentRoom.moveTimerId = new Timer(() => {
      if (!currentRoom.hasRolledTheDice)
        io.to(roomId).emit("log", "first roll the Rice");

      moveWazir(roomId, userId, currentRoom.nonBoundedWazir[0]);
    }, 1 * 500);
    return;
  }

  if (wazirThatCanMove.length > 1) {
    currentRoom.moveTimerId = new Timer(() => {
      if (!currentRoom.hasRolledTheDice)
        io.to(roomId).emit("log", "first roll the Rice");

      moveWazir(roomId, userId, currentRoom.nonBoundedWazir[0]);
      io.to(roomId).emit(
        "log",
        "backend called first wazir move after some delay"
      );
    }, currentRoom.waitTime * 1000);
  }
};

let resetRoom = (currentRoom) => {
  currentRoom.nonBoundedWazir = [];
  currentRoom.hasRolledTheDice = false;
  currentRoom.hasExtraLife = false;
  currentRoom.isWazirMoving = false;
  currentRoom.stepsToTake = 0;
};

let nextPlayer = (roomId) => {
  let currentRoom = Rooms.get(roomId);

  if (!currentRoom) return;

  let currentPlayerIndex = currentRoom.users.findIndex((user) => {
    if (user && user.id === currentRoom.currentPlayerId) return true;
  });

  if (currentPlayerIndex === -1) {
    console.log("can't find the current player");
    return;
  }

  let nextPlayerId = "";

  if (currentRoom.hasExtraLife) {
    nextPlayerId = currentRoom.currentPlayerId;
  } else {
    let nextPlayerIndex = currentPlayerIndex;
    let i = 0;
    while (i < 4) {
      nextPlayerIndex = ++nextPlayerIndex % 4;
      i++;
      if (currentRoom.users[nextPlayerIndex]) {
        nextPlayerId = currentRoom.users[nextPlayerIndex].id;
        break;
      }
    }
  }
  resetRoom(currentRoom);
  playerTurn(roomId, nextPlayerId);
};

let moveWazir = (roomId, socketId, wazirIndex) => {
  let currentRoom = Rooms.get(roomId);
  console.log(wazirIndex, "Clicked Wazir");

  if (!currentRoom) return;

  if (!currentRoom.hasRolledTheDice || currentRoom.stepsToTake === 0) {
    io.to(roomId).emit("log", "first roll the Dice");
    return;
  }

  if (currentRoom.isWazirMoving) {
    io.to(roomId).emit("log", "wazir is already moving");
    return;
  }

  if (currentRoom.currentPlayerId !== socketId) {
    io.to(roomId).emit("log", "you can't move the wazir");
    return;
  }

  currentRoom.moveTimerId.clear();

  const safeIndexes = [3, 11, 16, 24, 29, 37, 42, 50];

  if (
    currentRoom.nonBoundedWazir === undefined ||
    currentRoom.nonBoundedWazir.length === 0
  ) {
    console.log("There is no bounded wazir");
    return;
  }

  if (!currentRoom.nonBoundedWazir.includes(wazirIndex)) {
    io.to(roomId).emit("log", `Click Again ${wazirIndex}`);
    return;
  }

  io.to(roomId).emit("move", wazirIndex, socketId);

  let currentUser = currentRoom.users.find((user) => {
    if (user && user.id === socketId) return true;
  });
  let currentUserIndex = currentRoom.users.findIndex((user) => {
    if (user && user.id === socketId) return true;
  });

  wazirPosition = currentUser.wazirPosition[wazirIndex];

  if (wazirPosition < 0) {
    currentUser.wazirPosition[wazirIndex] = 0;
  } else if (wazirPosition < 51) {
    let offsetIndex = (13 * currentUserIndex) % 52;
    let newWazirPosition =
      (wazirPosition + currentRoom.stepsToTake + offsetIndex) % 52;

    console.log(`New Wazir Position ${newWazirPosition}`);
    let usersOnNewPosition = [];

    currentRoom.users.forEach((user, i) => {
      if (
        user &&
        [...user.wazirPosition]
          .map((pos) => (pos + i * 13) % 52)
          .includes(newWazirPosition)
      )
        usersOnNewPosition.push(user);
    });

    console.log(`users on New Position ${JSON.stringify(usersOnNewPosition)}`);

    if (
      usersOnNewPosition.length === 1 &&
      usersOnNewPosition[0].id !== socketId
    ) {
      let userIndex = currentRoom.users.findIndex((user) => {
        if (user && user.id === usersOnNewPosition[0].id) return true;
      });

      let wazirsOnNewPosition = [...usersOnNewPosition[0].wazirPosition]
        .map((pos) => pos + userIndex * 13)
        .filter((pos) => pos === newWazirPosition);

      console.log(`wazirs on New Position `, wazirsOnNewPosition);

      if (wazirsOnNewPosition.length === 1) {
        let idOfUserOnNewPos = usersOnNewPosition[0].id;
        let indexOfUserOnNewPos = currentRoom.users.findIndex((user) => {
          if (user && user.id === idOfUserOnNewPos) return true;
        });

        if (indexOfUserOnNewPos !== -1) {
          let indexOfWazirOnNewPos = currentRoom.users[
            indexOfUserOnNewPos
          ].wazirPosition.findIndex((pos) => pos === newWazirPosition);
          currentRoom.users[indexOfUserOnNewPos].wazirPosition[
            indexOfWazirOnNewPos
          ] = -1;
        }
      }
    }

    currentUser.wazirPosition[wazirIndex] =
      wazirPosition + currentRoom.stepsToTake;
  } else {
    currentUser.wazirPosition[wazirIndex] =
      wazirPosition + currentRoom.stepsToTake;
  }

  currentRoom.nonBoundedWazir = [];
  setTimeout(() => nextPlayer(roomId), currentRoom.stepsToTake * 500);
};

//toJson
let toJson = (roomId) => {
  return JSON.stringify(Rooms.get(roomId), (key, value) => {
    if (typeof value === "object" && value instanceof Timer) return;
    if (typeof value === "object" && value instanceof Set) {
      return [...value];
    }
    return value;
  });
};

io.on("connection", (socket) => {
  const { query } = socket.handshake;
  console.log("A new User is Connect by ws://", socket.id);

  //Add Users To Room and Emits "boardCreateed"
  socket.on("create", (data) => {
    let { username, roomId } = data;

    //if room exits it emits Failure
    if (socket.adapter.rooms.has(roomId)) {
      socket.emit(
        "loginFail",
        "Room Already Exist, You Can't Create with Same Name"
      );
      return;
    } else {
      let id = roomId.toLowerCase();
      //maping Room id to Board in Rooms Map
      Rooms.set(id, {
        admin: socket.id,
        users: [],
        gameStatus: "LOBBY",
        gameStatusArray: ["LOBBY", "PLAYING", "ENDED"],
        noOfPlayers: 0,
        currentPlayerId: "",
        nonBoundedWazir: [],
        stepsToTake: 0,
        hasRolledTheDice: false,
        hasExtraLife: false,
        isWazirMoving: false,
        waitTime: 15,
      });
      socket.emit("boardCreated", socket.id, id, toJson(id));
      addUser(socket, id, username);
      io.to(roomId).emit("log", `Admin ${username} is connected`);
    }
  });

  //Join the User to the room. BroadCast "newPlayer" and Emits "boardCreated"
  socket.on("join", (data) => {
    let { username, roomId } = data;
    let currentRoom = Rooms.get(roomId);
    //if Room doesn't Exist Emit Failure
    if (!checkRoom(roomId, socket)) {
      socket.emit("loginFail", `No room with this ${roomId} Room Id `);
      return;
    }

    //if Username Already in Room Emit Failure
    if (
      currentRoom.users.findIndex((user) => {
        return user === undefined ? false : user.username === username;
      }) !== -1
    ) {
      socket.emit(
        "loginFail",
        `${username} Already Exist. Change your Username`
      );
      return;
    }

    //if Player is Already present it emits Failure
    if (socket.adapter.rooms.get(roomId).has(socket.id)) {
      socket.emit("loginFail", `You are Already Connnected to ${roomId}`);
      return;
    }

    //Even if Room Size Full it Emits Failure
    //#TODO :: add Functionality to add prev Member (eg: On Reload Client Loses connection)3
    //@TODO :: Not to Join in Game isn't in Lobby
    if (socket.adapter.rooms.get(roomId).size === 4) {
      socket.emit("loginFail", `${roomId} Room is Full`);
      return;
    }
    socket.emit("boardCreated", socket.id, roomId, toJson(roomId));
    addUser(socket, roomId, username);
    io.to(roomId).emit("log", `New Player ${username} is connected`);
  });

  //update User ready State
  socket.on("ready", (roomId) => {
    let currentRoom = Rooms.get(roomId);
    if (checkRoom(roomId, socket)) {
      if (currentRoom.gameStatus !== "LOBBY") return;
      if (currentRoom.admin === socket.id) {
        console.log("EMIT ADMIN READY");
        socket.emit("log", `You are an admin`);
        return;
      }
      let playerIndex = currentRoom.users.findIndex((user) => {
        if (user === undefined) return false;
        if (user.id === socket.id) return true;
      });

      if (playerIndex !== -1) {
        let currentPlayer = currentRoom.users[playerIndex];
        let currentReadyState = !currentPlayer.isReady;
        currentRoom.users[playerIndex].isReady = currentReadyState;
        io.to(roomId).emit(
          "log",
          `${currentPlayer.username} change it state to ${
            currentReadyState ? "" : "NOT"
          } READY`
        );
        io.to(roomId).emit("ready", socket.id, currentReadyState);
      } else {
        console.log("SOMETHING BAD HAPPENED WITH READY STATE", socket.id);
      }
    } else {
      socket.emit(
        "gameFail",
        `Don't Act oversmart, ${roomId} room has Dissolved`
      );
    }
  });

  //on Start Set the RandomCurrentUser. Emits Turn
  socket.on("start", (roomId) => {
    let currentRoom = Rooms.get(roomId);
    if (checkRoom(roomId, socket)) {
      if (currentRoom.gameStatus !== "LOBBY") {
        io.to(roomId).emit(
          "log",
          "Don't be a idiot, can't start the start game again"
        );
        return;
      }

      if (!currentRoom.admin === socket.id) {
        //@TODO remove hardCoded index from Users as admin can change its index.
        socket.emit(
          "log",
          `${currentRoom.users[0].username} isn't admin and id is ${socket.id}`
        );
        return;
      }

      if (currentRoom.noOfPlayers < 2) {
        socket.emit("gameFail", `Atleast 2 player need to Start the Game`);
        socket.emit("log", `Atleast 2 player need to Start the Game`);
        return;
      }

      let notReadyUsers = currentRoom.users.filter((user) => {
        if (user === undefined) return false;
        if (user.isReady === false && user.id !== socket.id) return true;
      });

      if (notReadyUsers !== undefined && notReadyUsers.length > 0) {
        notReadyUsers.forEach((user, i) => {
          setTimeout(() => {
            io.to(roomId).emit("log", `${user.username} isn't ready`);
          }, i * 500);
        });
        return;
      }

      let randomUserIndex = Math.floor(Math.random() * 5) % 4;
      let hasFoundTheUser = false;
      let randomUserId = undefined;

      for (let i = 0; i < 4; i++, randomUserIndex++) {
        randomUserIndex = randomUserIndex % 4;
        let currentUser = currentRoom.users[randomUserIndex];
        if (currentUser !== undefined) {
          randomUserId = currentUser.id;
          hasFoundTheUser = true;
          currentRoom.currentPlayerIndex = randomUserIndex;
          currentRoom.gameStatus = "PLAYING";

          io.to(roomId).emit(
            "start",
            JSON.stringify({
              users: currentRoom.users,
              gameStatus: currentRoom.gameStatus,
            })
          );
          playerTurn(roomId, randomUserId);
          break;
        }
      }

      if (!hasFoundTheUser) {
        io.to(roomId).emit("log", "SORRY CAN'T FIND THE USER");
        return;
      }

      //@TODO addRandom Order and Check for Undefined Users
      io.to(roomId).emit(
        "log",
        `GAME IS ON :: ${randomUserIndex} USER HAS TURNED ON`
      );
    } else {
      socket.emit(
        "gameFail",
        `Don't Act oversmart, You aren't an admin of ${roomId} room`
      );
    }
  });

  socket.on("roll", (roomId) => {
    if (checkRoom(roomId, socket)) rollTheDice(roomId, socket.id);
  });

  socket.on("moveWazir", (roomId, wazirIndex) => {
    if (checkRoom(roomId, socket)) moveWazir(roomId, socket.id, wazirIndex);
  });

  socket.on("nextPlayer", () => {
    console.log("LOG ::", "nextPlayer");
  });

  //console.log msg from Client
  socket.on("log", (msg) => {
    console.log("LOG ::", msg);
  });

  // Listen for new messages
  socket.on("message", (data) => {
    io.in(roomId).emit("message", data);
  });

  // Leave the room if the user closes the socket and BroadCast "playerLeft"
  socket.on("disconnect", () => {
    //if Users isn't Map to Any Room
    if (!Users.has(socket.id)) {
      return;
    }

    //@TODO on admin leaves the game next player should become and an Admin
    removeUser(socket);
    console.log("USER LEFT");
  });
});

server.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});

// @TODO add client id to uuid and save browser localStorage on
// connection lose we can revive them using that id instead of
// socket.id
// in Simple word change socket.id from uuid.v4()

// const content = require('fs').readFileSync(__dirname + '/index.html', 'utf8');

// const httpServer = require('http').createServer((req, res) => {
//   // serve the index.html file
//   res.setHeader('Content-Type', 'text/html');
//   res.setHeader('Content-Length', Buffer.byteLength(content));
//   res.end(content);
// });
