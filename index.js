import express from 'express'

const app = require('express')();
// $FlowFixMe
const http = require('http').Server(app);
const io = require('socket.io')(http);
const router = express.Router();
const randomString = require('randomstring');
const uuid = require('uuid/v1');
const logger = require('morgan')("combined");
const bodyParser = require('body-parser');
const favicon = require('serve-favicon');
const path = require('path');
const compression = require('compression')
const fs = require('fs')


app.use(compression());
app.use(bodyParser.json());
app.use(logger)
app.use(express.static(path.join(__dirname, 'public')));
const favPath = path.join(__dirname, 'public', 'favicon.ico')
if (fs.existsSync(favPath)) {
  app.use(favicon(favPath));
}
app.set('view engine', 'html');



class Room {

  constructor(roomid, owner) {
    this.id = roomid
    this.owner = owner
    this.votes = {} //token to answer
    this.question = ""
    this.choices = { 1: "", 2: "", 3: "", 4: "" }
    this.ownerSocket = null
  }

  setOwnerSocket(socketId) {
    this.ownerSocket = socketId
  }

  clearVotes() {
    this.votes = {}
  }

  tally() {
    const ret = { 1: 0, 2: 0, 3: 0, 4: 0 };
    // should have done this in reverse...meh
    Object.keys(this.votes).forEach((key) => {
      const answer = this.votes[key];
      if (answer in ret) {
        ret[answer] += 1;
      } else {
        ret[answer] = 1;
      }
    });
    return ret;
  }

  vote(token, answer) { //TODO: incremental?
    this.votes[token] = answer
  }

  question() {
    return {
      question: this.question,
      choices: this.choices
    }
  }
}

class AllRoom { //TODO move this to redis?

  constructor() {
    this.rooms = {}
  }

  get(roomid) {
    return this.rooms[roomid]
  }

  has(roomid) {
    return this.rooms[roomid] ? true : false
  }

  createRoom(ownerToken, roomid) {
    roomid = roomid || randomString.generate({ length: 6, capitalization: 'uppercase' });
    const room = new Room(roomid, ownerToken);
    this.rooms[roomid] = room
    return room;
  }
}

const Rooms = new AllRoom()

router.get('/', (req, res, next) => {
  res.render('index', { title: 'Express' });
});

router.get('/v1/create-token', (req, res) => {
  res.json({
    token: uuid(),
  });
});

router.post('/v1/create-room', (req, res) => {
  const token = req.body.token;
  const room = Rooms.createRoom(token);
  res.json({
    roomId: room.id,
  });
});

router.get('*', function(req, res){
  res.sendFile('index.html', {root:'./public'});
});


function onRoomNotExist(socket, roomid) {
  const msg = `Room ${roomid} doesn't exist.`
  socket.emit('connect-fail', { msg: `Room ${roomid} doesn't exist.` })

}

function onConnect(socket, roomid, token) {
  console.log('Connect', roomid, token, socket.id)
  if (!Rooms.has(roomid)) {
    onRoomNotExist(socket, roomid);
    socket.disconnect()
    return
  }

  try {
    const room = Rooms.get(roomid)
    if (room.owner == token) {
      room.setOwnerSocket(socket.id)
    }
    socket.join(roomid, () => setupSocket(socket, roomid, token))
  }
  catch (err) {
    console.error(err)
  }
}

//wrap socket event handler so it catch exception
function wrap(socket, f) {
  try {
    return (data) => f(data)
  } catch (err) {
    console.error(err) //print traceback here
    socket.emit('server-error')
  }
}

function setupSocket(socket, roomid, token) {
  const onTally = wrap(socket, (data) => { //tally echo
    socket.emit('tally', Rooms.get(roomid).tally())
  })

  const sendTallyToOwner = (room) => io.to(room.ownerSocket).emit('tally', room.tally())

  const onVote = wrap(socket, (data) => { //receive vote from student
    const room = Rooms.get(roomid)
    room.vote(data.token, data.answer)
    sendTallyToOwner(room)
  })

  const onClearVote = wrap(socket, (data) => { //teacher click clear vote
    const room = Rooms.get(roomid)
    room.clearVotes()
    socket.to(roomid).emit('vote-clear')
    sendTallyToOwner(room)
  })
  socket.use((packet, next)=>{console.log(token, packet[0]); next()})

  socket.on('tally', onTally)
  socket.on('vote', onVote)
  socket.on('clear-vote', onClearVote)
}

io.use((socket, next) => {
  console.log(socket.request.url)
  next()
})

io.on('connection', (socket) => {
  const handshake = socket.handshake
  const { roomid, token } = handshake.query
  onConnect(socket, roomid, token)
})

app.use('/', router)

http.listen(5555, function () {
  console.log('listening on *:5555');
});



