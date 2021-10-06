/create - generates a random appointment
/read - gets the appointment whose ID was passed as the payload {id: ?}
    gets all appointments with no payload
/update - updates the appointment whose ID was passed with the timeslot in the payload {id: ?, timeslot: ?}
/delete - deletes the appointment whose ID was passed as the payload {id: ?}


Access the API by starting the app.js via node and then either opening the index.html file locally OR by directly accessing the API endpoints at http://localhost:3000/

You must have a file called appointmentsDB.db in the same folder as app.js, it can be an empty file when you first start the application.

Running this will require you to have the following installed:
    * node.js
    * sqlite3 which can be installed using the following
        npm install sqlite3