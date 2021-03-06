HOST = null; // localhost
PORT = 8001;

// when the daemon started
var starttime = (new Date()).getTime();

var mem = process.memoryUsage();
// every 10 seconds poll for the memory.
setInterval(function () {
  mem = process.memoryUsage();
}, 10*1000);


var fu = require("./fu"),
    sys = require("sys"),
    url = require("url"),
    qs = require("querystring");

var MESSAGE_BACKLOG = 200,
    SESSION_TIMEOUT = 60 * 1000;

var channel = new function () {
  var messages = [],
      callbacks = [];

  this.appendMessage = function (nick, type, text) {
    var m = { nick: nick
            , type: type // "msg", "join", "part"
            , text: text
            , timestamp: (new Date()).getTime()
            };

    switch (type) {
      case "msg":
        sys.puts("<" + nick + "> " + text);
        break;
      case "join":
        sys.puts(nick + " join");
        break;
      case "part":
        sys.puts(nick + " part");
        break;
    }

    messages.push( m );

    while (callbacks.length > 0) {
      callbacks.shift().callback([m]);
    }

    while (messages.length > MESSAGE_BACKLOG)
      messages.shift();
  };

  this.query = function (since, callback) {
    var matching = [];
    for (var i = 0; i < messages.length; i++) {
      var message = messages[i];
      if (message.timestamp > since)
        matching.push(message)
    }

    if (matching.length != 0) {
      callback(matching);
    } else {
      callbacks.push({ timestamp: new Date(), callback: callback });
    }
  };

  // clear old callbacks
  // they can hang around for at most 30 seconds.
  setInterval(function () {
    var now = new Date();
    while (callbacks.length > 0 && now - callbacks[0].timestamp > 30*1000) {
      callbacks.shift().callback([]);
    }
  }, 3000);
};

var sessions = {};

function checkNick(nick) {
  if (nick.length > 50) return false;
  if (/[^\w_\-^!'`~&*\[\]\(\)]/.exec(nick)) return false;
  for (var i in sessions) {
    var session = sessions[i];
    if (session && session.nick === nick) return false;
  }
  return true;
}

function createSession (nick) {
  if(!(checkNick(nick))) return null;
  var session = {
    nick: nick,
    id: Math.floor(Math.random()*99999999999).toString(),
    timestamp: new Date(),

    poke: function () {
      session.timestamp = new Date();
    },

    destroy: function () {
      channel.appendMessage(session.nick, "part");
      delete sessions[session.id];
    }
  };

  sessions[session.id] = session;
  return session;
}

// interval to kill off old sessions
setInterval(function () {
  var now = new Date();
  for (var id in sessions) {
    if (!sessions.hasOwnProperty(id)) continue;
    var session = sessions[id];

    if (now - session.timestamp > SESSION_TIMEOUT) {
      session.destroy();
    }
  }
}, 1000);

fu.listen(PORT, HOST);

fu.get("/", fu.staticHandler("index.html"));
fu.get("/style.css", fu.staticHandler("style.css"));
fu.get("/client.js", fu.staticHandler("client.js"));
fu.get("/jquery-1.2.6.min.js", fu.staticHandler("jquery-1.2.6.min.js"));

function randint(max) {
  return Math.floor(Math.random() * max) + 1
}

fu.get("/choice", function (req, res) {
  var r = qs.parse(url.parse(req.url).query),
      session = sessions[r.id];

  if (!session || !r.choices) {
    res.simpleJSON(400, { error: "No such session id" });
    return;
  }

  var value = r.choices[ randint(r.choices.length) - 1 ]; // -1 for the zero-based indexing
  session.poke();
  channel.appendMessage("[choice]",
                        "msg",
                        session.nick + " requests a random choice between " +
                        r.choices.slice(0, -1).join(", ") + ", and " + r.choices.slice(-1)[0] + ": " + value);
  res.simpleJSON(200, { result: "Random choice selected: " + value });
});

fu.get("/kick", function(req, res) {
  var r = qs.parse(url.parse(req.url).query),
      session = sessions[r.id],
      power = r.power || 10;
  if(!session || !r.who) {
    res.simpleJSON(400, { error: "No such session id" });
    return;
  }
  session.poke();
  channel.appendMessage("[kick]", "msg",
                        session.nick + " kicks " + r.who +
                        " with a power of " + randint(power) + ".");
  res.simpleJSON(200, { result: "You kicked " + r.who });
});

fu.get("/dice", function (req, res) {
  var r = qs.parse(url.parse(req.url).query);
  var session = sessions[r.id],
      value = randint(r.size);

  if (!session || !r.size) {
    res.simpleJSON(400, { error: "No such session id" });
    return;
  }

  session.poke();
  channel.appendMessage("[dice]", "msg", session.nick + " rolls a " + r.size + " sided die, and gets a " + value);
  res.simpleJSON(200, { result: "Dice roll returned " + value });
});

fu.get("/nick", function (req, res) {
  var r = qs.parse(url.parse(req.url).query),
      session = sessions[r.id],
      oldnick = session.nick;

  if (!session || !r.nick) {
    res.simpleJSON(400, { error: "No such session id" });
    return;
  }

  if(!checkNick(r.nick)){
    res.simpleJSON(400, { error: "Bad nick" });
    return;
  }

  session.nick = r.nick;
  session.poke();
  channel.appendMessage("[nick]", "msg", oldnick + " is now known as " + session.nick);
  res.simpleJSON(200, { result: "You are now known as " + session.nick });
});

fu.get("/who", function (req, res) {
  var nicks = [];
  for (var id in sessions) {
    if (!sessions.hasOwnProperty(id)) continue;
    var session = sessions[id];
    nicks.push(session.nick);
  }
  res.simpleJSON(200, { nicks: nicks
                      , rss: mem.rss
                      });
});

fu.get("/join", function (req, res) {
  var nick = qs.parse(url.parse(req.url).query).nick;
  if (nick == null || nick.length == 0) {
    res.simpleJSON(400, {error: "Bad nick."});
    return;
  }
  var session = createSession(nick);
  if (session == null) {
    res.simpleJSON(400, {error: "Nick in use"});
    return;
  }

  //sys.puts("connection: " + nick + "@" + res.connection.remoteAddress);

  channel.appendMessage(session.nick, "join");
  res.simpleJSON(200, { id: session.id
                      , nick: session.nick
                      , rss: mem.rss
                      , starttime: starttime
                      });
});

fu.get("/part", function (req, res) {
  var id = qs.parse(url.parse(req.url).query).id;
  var session;
  if (id && sessions[id]) {
    session = sessions[id];
    session.destroy();
  }
  res.simpleJSON(200, { rss: mem.rss });
});

fu.get("/recv", function (req, res) {
  if (!qs.parse(url.parse(req.url).query).since) {
    res.simpleJSON(400, { error: "Must supply since parameter" });
    return;
  }
  var id = qs.parse(url.parse(req.url).query).id;
  var session;
  if (id && sessions[id]) {
    session = sessions[id];
    session.poke();
  }

  var since = parseInt(qs.parse(url.parse(req.url).query).since, 10);

  channel.query(since, function (messages) {
    if (session) session.poke();
    res.simpleJSON(200, { messages: messages, rss: mem.rss });
  });
});

fu.get("/send", function (req, res) {
  var id = qs.parse(url.parse(req.url).query).id;
  var text = qs.parse(url.parse(req.url).query).text;

  var session = sessions[id];
  if (!session || !text) {
    res.simpleJSON(400, { error: "No such session id" });
    return;
  }

  session.poke();

  channel.appendMessage(session.nick, "msg", text);
  res.simpleJSON(200, { rss: mem.rss });
});
