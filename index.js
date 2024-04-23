import express from "express";
import axios from "axios"
import bodyParser from "body-parser";
import pg from "pg"
import bcrypt from "bcrypt";
import passport from "passport";
import { Strategy } from "passport-local";
import GoogleStrategy from "passport-google-oauth2"
import session from "express-session";
import env from "dotenv";

const app = express();
const port = 3000;
const saltRounds = 10;
env.config();


let booksIDs = [];
let currentBook;
let persistantBook;
let filterType;
let currentUser;
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
  })
);
app.use(bodyParser.urlencoded({extended: true}));
app.use(express.static("public"))

app.use(passport.initialize());
app.use(passport.session());

const db = new pg.Client({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT,
});
db.connect();

passport.use("local", new Strategy(async function verify(username, password, cb) {

  try {
      const result = await db.query("SELECT * FROM users WHERE email = $1 ", [username]);
      
      if (result.rows.length > 0) {
          const user = result.rows[0];
          const storedHashedPassword = user.password;
          const valid = await bcrypt.compare(password, storedHashedPassword);
          if (valid) {
              // Password matches, authentication successful
              console.log("Authentication Successful. User:", user);
              return cb(null, user);
          } else {
              // Password does not match
              console.log("Authentication Failed. Invalid Password.");
              return cb(null, false);
          }
      } else {
          // User not found
          console.log("Authentication Failed. User not found.");
          return cb(null, false);
      }
  } catch (err) {
      console.log("Error:", err);
      return cb(err);
  }
}));

passport.use(
  "google",
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "http://localhost:3000/auth/google/home",
      userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo",
    },
    async (accessToken, refreshToken, profile, cb) => {
      try {
        // console.log(profile);
        const result = await db.query("SELECT * FROM users WHERE email = $1", [
          profile.email,
        ]);
        if (result.rows.length === 0) {
          console.log(profile);
          const newUser = await db.query(
            "INSERT INTO users (name, email, password) VALUES ($1, $2, $3)",
            [profile.given_name, profile.email, "google"]
          );
          return cb(null, newUser.rows[0]);
        } else {
          return cb(null, result.rows[0]);
        }
      } catch (err) {
        return cb(err);
      }
    }
  )
);

// Handle Passport serialization and deserialization

passport.serializeUser((user, cb) => {
  cb(null, user);
});
passport.deserializeUser((user, cb) => {
  cb(null, user);
});


  





app.get("/",(req,res)=>{
    res.render("logIn.ejs");
});

app.get("/register",(req,res)=>{
    res.render("register.ejs");
});
app.get("/home", async (req, res)=>{
  
  if (req.isAuthenticated()) {
    try {
      
      currentUser = req.user.id;
      const result = await db.query("SELECT * FROM books WHERE user_id = $1 ORDER BY rating DESC",[currentUser]);
      let allBooks = result.rows;   
      booksIDs = [];
      filterType = "Rating"
      console.log(req.user);
      res.render("index.ejs", 
      { 
        activePage: 'home',
        books: allBooks,
        selection: filterType,
        user: req.user.name
       });  
    } catch (error) {
        console.log(error);
    }    
  } else{
    res.redirect("/");
  }
    
    
});
    
app.get("/logout", (req, res) => {
  req.logout(function (err) {
    if (err) {
      return next(err);
    }
    res.redirect("/");
  });
});
    


app.get("/addBook",(req,res)=>{
  if (req.isAuthenticated()) {
    res.render("addBook.ejs",{activePage: 'addBook',
    user: req.user.name
  });
  }else{
    res.redirect("/");
  }
    
});


app.get("/bookReviews",async (req,res)=>{
 
 if (req.isAuthenticated()) {
  try {
    const result = await db.query("SELECT DISTINCT ON (b.isbn) b.*, u.name FROM books b LEFT JOIN users u ON b.user_id = u.id ORDER BY b.isbn, u.name;");    
    filterType = "Rating"
    // console.log(result.rows);
    res.render("bookReviews.ejs",{
      activePage: 'bookReviews',
      books: result.rows,
      selection: filterType,
      user: req.user.name
    });
  
  } catch (error) {
      console.log(error);
    }
 }else{
  res.redirect("/")
 }
  
  
});
app.get("/book", async (req,res)=>{
    
    try {
      const bookResult = await db.query("SELECT * FROM books WHERE bookid = $1",[currentBook]);
        console.log(bookResult.rows);
        res.render("book.ejs", {activePage: 'book',
        book: bookResult.rows[0],
        user: req.user.name
        });
    } catch (error) {
        console.log(error);
    }

    
});
app.get("/edit", async (req,res)=>{
    console.log("success");
    try {
      const response = await db.query("SELECT * FROM books WHERE bookid = $1",[currentBook]);
     
        // console.log(response.rows[0].date_read);
        res.render("editBook.ejs", {activePage: 'book',
        bookItem: response.rows[0],
        user: req.user.name
        });
    } catch (error) {
        console.log(error);
    }

    
});
app.get(
  "/auth/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
  })
);



app.get(
  "/auth/google/home",
  passport.authenticate("google", {
    successRedirect: "/home",
    failureRedirect: "/",
  })
);




app.post("/login", passport.authenticate("local",{
  successRedirect: "/home",
  failureRedirect: "/"
}));


app.post("/addBook", async (req, res) => {
  console.log("clicked");
  console.log(req.body);
    try {
        const { ISBN, readDate, rating, bookDescription, bookNotes, bookTitle, bookAuthor } = req.body;
        
        // Fetch book cover from Open Library API
        const response = await axios.get(`https://covers.openlibrary.org/b/isbn/${ISBN}.json`);

        // If cover is found, extract the cover URL
        let coverUrl;
        if (response.data.id) {
            coverUrl = `https://covers.openlibrary.org/b/id/${response.data.id}-M.jpg`;
        } else {
            // If cover is not found, redirect the user to addBook page with an error message
            res.render("addBook.ejs", { activePage: 'addBook', errorMessage: 'Cover image not found. Please try another ISBN number.', user: req.user.name });
            return; // Stop further execution
        }

        // Insert book into database with cover URL
        await db.query("INSERT INTO books (isbn, date_read, rating, description, book_notes, user_id, title, img_url, author) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *", [ISBN, readDate, rating, bookDescription, bookNotes, currentUser, bookTitle, coverUrl, bookAuthor]);
        
        // Redirect to home page after successful insertion
        res.redirect("/home");
    } catch (error) {
        console.error('Error:', error);
        // If there's an error (e.g., 404), redirect the user to addBook page with an error message
        res.render("addBook.ejs", { activePage: 'addBook', errorMessage: 'The ISBN number was not valid please add a new one.', user: req.user.name });
        
    }
});

app.post("/book",(req,res)=>{
    console.log(req.body["selectedBook"]);
    currentBook = req.body["selectedBook"];
    res.redirect("/book");
});
app.post("/edit", async (req,res)=>{
    console.log(req.body["selectedBook"]);
    currentBook = req.body["selectedBook"];
    try {
        const result = await db.query("SELECT * FROM books WHERE bookid = $1", [currentBook]);
        persistantBook = result.rows[0];
    } catch (error) {s
        console.log(error);
    }
    res.redirect("/edit");
});
app.post("/updateBook",async (req,res)=>{
    console.log(req.body.bookTitle);
    console.log(currentBook);
    

    try {
        const { ISBN, readDate, rating, bookDescription, bookNotes, bookTitle, bookAuthor } = req.body;
        
        // Fetch book cover from Open Library API
        const response = await axios.get(`https://covers.openlibrary.org/b/isbn/${ISBN}.json`);

        // If cover is found, extract the cover URL
        let coverUrl;
        if (response.data.id) {
            coverUrl = `https://covers.openlibrary.org/b/id/${response.data.id}-M.jpg`;
        } else {
            // If cover is not found, redirect the user to addBook page with an error message
            res.render("editBook.ejs", {activePage:'update',  errorMessage: 'Cover image not found. Please try another ISBN number.',bookItem: req.body });
            return; // Stop further execution
        }

        // Insert book into database with cover URL
        await db.query("UPDATE books SET isbn = $1, date_read = $2, rating = $3, description = $4, book_notes = $5, title = $6, img_url = $7, author = $8 WHERE bookid = $9 RETURNING *", [ISBN, readDate, rating, bookDescription, bookNotes, bookTitle, coverUrl, bookAuthor,currentBook]);
        
        // Redirect to home page after successful insertion
        res.redirect("/home");
    } catch (error) {
        console.error('Error:', error);
        // If there's an error (e.g., 404), redirect the user to addBook page with an error message
        res.render("editBook.ejs", {activePage:'update',  errorMessage: 'The ISBN number was not valid please add a new one.', bookItem: persistantBook });
        
    }
});

app.post("/filter", async (req, res) => {
    try {
        let filteredBooks = [];
        let filterType = "";

        switch (req.body.choice) {
            case "rating":
                const ratingResult = await db.query("SELECT * FROM books WHERE user_id = $1 ORDER BY rating DESC", [currentUser]);
                filterType = "Rating";
                filteredBooks = ratingResult.rows;
                break;
            case "readDate":
                const readDateResult = await db.query("SELECT * FROM books WHERE user_id = $1 ORDER BY date_read DESC", [currentUser]);
                filterType = "Read Date";
                filteredBooks = readDateResult.rows;
                break;
            case "title":
                const titleResult = await db.query("SELECT * FROM books WHERE user_id = $1 ORDER BY title ASC", [currentUser]);
                filterType = "Title";
                filteredBooks = titleResult.rows;
                break;
            default:
                break;
        }

        res.render("index.ejs", {
            activePage: 'home',
            books: filteredBooks,
            selection: filterType,
            user: req.user.name
        });
    } catch (error) {
        console.error("Error:", error);
        res.status(500).send("Internal Server Error");
    }
});

  app.post("/delete",async(req,res)=>{
    console.log(req.body);
    try {
        await db.query("DELETE FROM books WHERE bookid = $1",[req.body.selectedBook]);
        res.redirect("/home");
    } catch (error) {
        console.log(error);
    }
  });

  app.post("/register", async (req, res) => {
    console.log(req.body);
    const name = req.body.name
    const email = req.body.email;
    const password = req.body.password;
  
    try {
      const checkResult = await db.query("SELECT * FROM users WHERE email = $1", [
        email,
      ]);
  
      if (checkResult.rows.length > 0) {
        res.redirect("/");
      } else {
        bcrypt.hash(password, saltRounds, async (err, hash) => {
          if (err) {
            console.error("Error hashing password:", err);
          } else {
            const result = await db.query(
              "INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING *",
              [name, email, hash]
            );
            const user = result.rows[0];
            req.login(user, (err) => {
              console.log("success");
              res.redirect("/home");
            });
          }
        });
      }
    } catch (err) {
      console.log(err);
    }
  });



app.listen(port, () =>{
    console.log(`Server is running at port: ${port}`);
});