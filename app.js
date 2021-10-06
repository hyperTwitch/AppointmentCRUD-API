const http = require('http');
const querystring = require('querystring');
const sqlite3 = require('sqlite3').verbose();

// SEVER LISTENING ON http://localhost:3000
const hostname = '127.0.0.1';
const port = 3000;

/*
 * PROCESS POST REQUESTS TO GET THE PAYLOAD BEFORE RUNNING COMMANDS
 */
function processPost(request, response, queryParams, callback) {
    var queryData = "";

    // When data comes in, add it to the cumulative string of data
    request.on('data', function(data) {
      queryData += data;
      if(queryData.length > 1e6) {
          queryData = "";
          response.writeHead(413, {'Content-Type': 'text/plain'}).end();
          request.connection.destroy();
      }
    });

    // When the end data signal is received parse the data received
    request.on('end', function() {
      // Set the parameters to those grabbed from the buffer first
      request.post = querystring.parse(queryData);

      console.log("Buffer data: " + JSON.stringify(request.post));

      if(queryParams) {
        console.log("Query data: " + queryParams);

        // Then add in parameters from the query string if there are any
        queryParams.split("&").forEach(function(part) {
          var item = part.split("=");
          if(item[0] != "_" && item[1] != "") {
            request.post[item[0]] = decodeURIComponent(item[1]);
          }
        });
      }

      // Send the query data back to the main thread
      callback();
    });
}

/*
 * SETUP THE DATABASE WITH SOME STARTER INFORMATION
 */
function setupDB() {
  // If there is no goods and services table yet, make on and initialize its product database with some items
  db.get(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='goodsServices_table'`, (err, row) => {
    if(row["COUNT(*)"] == 0) {
      db.serialize(() => {
        console.log("Creating the goods and services table.");
        db.run(`CREATE TABLE goodsServices_table(id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(255) NOT NULL, price DECIMAL(6, 2) NOT NULL)`);
        db.run(`
          INSERT INTO
            goodsServices_table (name, price)
          VALUES
            ("oil change", 60.00),
            ("fill tires with air", 00.00),
            ("tire rotation", 30.00),
            ("air filter", 15.00),
            ("car wash", 20.00),
            ("detailing", 40.00),
            ("air freshener", 5.00)
        `);
      });
    }
  });

  // If there is no appointment schedule table yet, make one
  console.log("Creating the appointment schedule table if needed.")
  db.run(`CREATE TABLE IF NOT EXISTS appointmentSchedule_table(id INTEGER PRIMARY KEY AUTOINCREMENT, timeslot DATETIME NOT NULL)`);

  // If there is no appointment services table yet, make one
  console.log("Creating the appointment services table if needed.")
  db.run(`
    CREATE TABLE IF NOT EXISTS
      appointmentServices_table (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        appointmentID INTEGER NOT NULL,
        goodServiceID INTEGER NOT NULL,
        FOREIGN KEY (appointmentID) REFERENCES appointmentSchedule_table(id),
        FOREIGN KEY (goodServiceID) REFERENCES goodsServices_table(id)
      )
  `);
}

/*
 * READ AND RETURN AN ARRAY OF APPOINTMENT OBJECTS FROM THE DATABASE
 * IF AN ID IS SUPPLIED, ONLY APPOINTMENTS WITH THAT ID ARE RETURNED
 */
function readAppointments(requestData) {
  let returnAppointments = [];
  // If there were no arguments passed, then grab all appointments
  if(Object.keys(requestData).length === 0) {
    returnAppointments = new Promise((resolve, reject) => {
      db.all(`SELECT
    appointmentSchedule_table.id as id, timeslot, goodsServices_table.name as goodService, goodsServices_table.price as goodServicePrice
  FROM
    appointmentSchedule_table
  JOIN
    appointmentServices_table ON appointmentSchedule_table.id = appointmentServices_table.appointmentID
  JOIN
    goodsServices_table ON appointmentServices_table.goodServiceID = goodsServices_table.id`, function(err, rows) {
        if(err) {
          reject("Read error: " + err.message);
        }
        else {
          console.log("Grabbed all appointments");
          resolve(JSON.stringify(rows));
        }
      });
    });
  }
  // If an id was passed, grab only that appointment
  else if(requestData.id) {
    returnAppointments = new Promise((resolve, reject) => {
      db.all(`SELECT
    appointmentSchedule_table.id as id, timeslot, goodsServices_table.name as goodService, goodsServices_table.price as goodServicePrice
  FROM
    appointmentSchedule_table
  JOIN
    appointmentServices_table ON appointmentSchedule_table.id = appointmentServices_table.appointmentID
  JOIN
    goodsServices_table ON appointmentServices_table.goodServiceID = goodsServices_table.id
WHERE
  appointmentSchedule_table.id = ?`, requestData.id, function(err, row) {
        if(err) {
          reject("Read error: " + err.message);
        }
        else {
          console.log("Grabbed record " + requestData.id);
          resolve(JSON.stringify(row));
        }
      });
    });
  }
  // Otherwise throw and error for unsupported request
  else {
    returnAppointments = false;
  }
  return returnAppointments;
}

/*
 * UPDATE THE APPOINTMENT TIMESLOT WITH THE GIVEN INFORMATION.
 * PARAMS MUST INCLUDE id AND timeslot.
 * timeslot MUST BE PRE-FORMATTED AS A SQL DATETIME "yyyy-mm-dd hh:mm:ss"
 */
function updateAppointment(params) {
  return new Promise((resolve, reject) => {
    if(params.id && params.timeslot) {
      db.serialize(() => {
        db.run("UPDATE appointmentSchedule_table SET timeslot = ? WHERE id = ?", [params.timeslot, params.id], function(err) {
          if(err) {
            reject("Could not update: " + err.message);
          }
          else {
            console.log(`Updated appointment ${params.id}`);
            resolve("success");
          }
        });
      });
    }
    else {
      reject("Please supply an ID of an appointment to update");
    }
  });
}

/*
 * DELETE THE APPOINTMENT WITH THE GIVEN ID AND IT'S ASSOCIATED SERVICES
 */
function deleteAppointment(id) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run("DELETE FROM appointmentServices_table WHERE appointmentID=?", id);
      db.run("DELETE FROM appointmentSchedule_table WHERE id=?", id, function(err) {
        if(err) {
          reject("Could not delete: " + err.message);
        }
        else {
          console.log(`Deleted appointment ${id}`);
          resolve("success");
        }
      });
    });
  })
}

/*
 * CREATE A RANDOM APPOINTMENT WITH 1-5 RANDOMLY SELECTED SERVICES ASSOCIATED WITH IT
 */
function createRandomAppointment() {
  db.serialize(() => {
    // Get a list of all the available goods and services
    let goodsServices = [];
    db.all("SELECT id FROM goodsServices_table", (err, rows) => {
      goodsServices = rows.map(function(row) {
        return row.id;
      });
    });

    // Generate a random datetime value within the next year
    db.get(`SELECT datetime(strftime('%s', '2021-10-03 00:00:00') + abs(random() % (strftime('%s', '2022-10-03 23:59:59') - strftime('%s', '2021-10-03 00:00:00'))), 'unixepoch') AS randomAppointment`, (err, row) => {
      console.log("Creating appointment" + JSON.stringify(row.randomAppointment));

      // Create the new appointment with the random time
      db.run(`INSERT INTO appointmentSchedule_table (timeslot) VALUES (?)`, [row.randomAppointment], function(err) {
        // Get the id of the newly added appointment
        db.get("SELECT last_insert_rowid() as randomAppointmentId", (err, row) => {
          // Generate a random number of randomly selected services (up to 5) and associate them with the new appointment
          let numScheduledServices = Math.floor(Math.random() * 5 + 1);
          console.log(`Creating ${numScheduledServices} services for new appointment with ID of ` + JSON.stringify(row.randomAppointmentId));
          for(let i = 0; i < numScheduledServices; i ++) {
            let index = Math.floor(Math.random() * goodsServices.length);
            console.log(`Creating service number ${(i + 1)} as ${index}`);
            db.run(`INSERT INTO appointmentServices_table (appointmentID, goodServiceID) VALUES (?, ?)`, [row.randomAppointmentId, goodsServices[index]]);
          }
        });
      });
    });
  });
}

/*
 * SETUP THE SERVER ENDPOINTS AND HANDLE SENDING/RECEIVING REQUESTS ON THEM
 */
const server = http.createServer((req, res) => {
  // allow CORS
  res.setHeader('Access-Control-Allow-Origin', `*`);
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
  res.setHeader('Access-Control-Allow-Credentials', true);

  let responsePromise = new Promise(function(resolve, reject) {
    let requestSplitQueries = (req.url).indexOf("?") > 0 ? (req.url).indexOf("?") : req.url.length + 1;
    let request = (req.url).substring(1, requestSplitQueries);
    let queryParams = (req.url).substring(requestSplitQueries + 1);

    console.log("**************************");
    console.log("Starting command: " + request);

    // Process the request by first grabbing any passed data
    processPost(req, res, queryParams, function() {
      console.log("Received data: " + JSON.stringify(req.post));
      switch(request) {
        case "create":
          createRandomAppointment();
          res.setHeader('Content-Type', 'text/plain');
          resolve("appointment created");
          break;
        case "read":
          res.writeHead(200, {"content-type": "application/json"});
          resolve(readAppointments(req.post));
          break;
        case "update":
          res.setHeader('Content-Type', 'text/plain');
          resolve(updateAppointment(req.post));
          break;
        case "delete":
          res.setHeader('Content-Type', 'text/plain');
          if(req.post.id) {
            deleteAppointment(req.post.id);
            resolve("success");
          }
          else {
            reject("no id supplied");
          }
          break;
        default:
          reject("Bad Request");
      }
    });
  }).then(
    responseText => {
      res.end(responseText);
    }
  ).catch(err => {
    console.error(err);
  });
});

// OPEN THE DATABASE CONNECTION
let db = new sqlite3.Database('appointmentsDB.db', sqlite3.OPEN_READWRITE, (err) => {
  // If there was an issue opening the DB file, shutdown the system
  if (err) {
    console.error(err.message + ". Please create a file called appointmentsDB.db.");
    shutdownProcess();
  }
  else {
    console.log('Connected to the appointments database.');

    setupDB();
  }
});

// START THE SERVER
server.listen(port, hostname, () => {
  console.log(`Server running at http://${hostname}:${port}/`);
});

// CATCH CALLS TO KILL THE PROGRAM AND SHUT IT DOWN GRACEFULLY
process.on('SIGINT', shutdownProcess);
process.on('SIGTERM', shutdownProcess);
process.on('SIGKILL', shutdownProcess);
process.on('SIGBREAK', shutdownProcess);
function shutdownProcess() {
  db.close();
  server.close(() => {
    console.log('Process terminated');
  });
}