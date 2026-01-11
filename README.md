# Personal Portfolio Website

A production-ready, full-stack personal portfolio built to demonstrate professional software engineering practices. This project showcases clean architecture, RESTful API design, database modeling, and modern deployment strategies.

**Live Demo:** [Your GitHub Pages URL]  
**Backend API:** [Your Render/Fly.io URL]

## Project Overview

This portfolio is designed specifically for technical recruiters and hiring managers. Unlike typical portfolio websites, this project emphasizes backend competence, system design thinking, and production engineering practices.

The application is split into two deployable components:
- **Frontend**: Static site (HTML/CSS/JavaScript) hosted on GitHub Pages
- **Backend**: Python Flask REST API with SQL database hosted on Render or Fly.io

This architecture demonstrates understanding of:
- Separation of concerns
- Stateless API design
- Cross-origin resource sharing (CORS)
- Environment-based configuration
- Database-driven applications

## Tech Stack

### Frontend
- **HTML5**: Semantic markup with accessibility in mind
- **CSS3**: Modern layout using Flexbox and Grid (no frameworks)
- **Vanilla JavaScript**: Clean, modular code without dependencies
- **GitHub Pages**: Static site hosting

### Backend
- **Python 3.10+**: Core programming language
- **Flask 3.0**: Lightweight WSGI web framework
- **SQLite**: Development database (file-based)
- **PostgreSQL**: Production database (deployment-ready)
- **Gunicorn**: Production WSGI server
- **Flask-CORS**: Cross-origin request handling

### Tools & Deployment
- **Git/GitHub**: Version control and repository hosting
- **Render** or **Fly.io**: Backend hosting platform
- **SQLite → PostgreSQL**: Database migration path

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         CLIENT BROWSER                       │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ HTTPS
                         │
         ┌───────────────▼───────────────┐
         │   GITHUB PAGES (Frontend)     │
         │  - index.html                 │
         │  - projects.html              │
         │  - contact.html               │
         │  - admin.html                 │
         │  - CSS/JS assets              │
         └───────────────┬───────────────┘
                         │
                         │ AJAX (fetch API)
                         │
         ┌───────────────▼───────────────┐
         │ RENDER/FLY.IO (Backend)       │
         │  Flask Application            │
         │  ┌─────────────────────┐      │
         │  │  API Routes         │      │
         │  │  - GET  /api/projects     │
         │  │  - POST /api/projects     │
         │  │  - POST /api/contact      │
         │  └──────────┬──────────┘      │
         │             │                 │
         │  ┌──────────▼──────────┐      │
         │  │  Database Layer     │      │
         │  │  - db.py            │      │
         │  │  - Connection pool  │      │
         │  └──────────┬──────────┘      │
         │             │                 │
         │  ┌──────────▼──────────┐      │
         │  │  PostgreSQL DB      │      │
         │  │  - projects table   │      │
         │  │  - contacts table   │      │
         │  └─────────────────────┘      │
         └───────────────────────────────┘
```

### Key Design Decisions

**1. Stateless API Design**
- No session management required
- Each request is independent
- Scalable horizontally
- Frontend handles all UI state

**2. SQL Database Choice**
- Structured data (projects, contacts)
- ACID compliance for data integrity
- Relational model fits use case
- Migration path: SQLite → PostgreSQL

**3. No Authentication on Admin Panel**
- **Intentional for portfolio demonstration**
- Documents understanding of security tradeoffs
- In production: would implement JWT/OAuth
- Comment in code acknowledges this decision

**4. Separation of Frontend/Backend**
- Independent deployment cycles
- Frontend served from CDN (GitHub Pages)
- Backend can scale independently
- Clear API contract between layers

## Database Schema

### Projects Table
```sql
CREATE TABLE projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL CHECK(length(title) <= 200),
    description TEXT NOT NULL CHECK(length(description) <= 2000),
    tech_stack TEXT NOT NULL CHECK(length(tech_stack) <= 300),
    github_url TEXT CHECK(github_url IS NULL OR length(github_url) <= 300),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Design Notes:**
- `title`: Short, display-friendly project name
- `description`: Includes problem statement + technical approach
- `tech_stack`: Comma-separated (denormalized for simplicity)
- `github_url`: Optional, for open-source projects
- `created_at`: Audit trail, enables "recent projects" ordering

### Contacts Table
```sql
CREATE TABLE contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL CHECK(length(name) <= 100),
    email TEXT NOT NULL CHECK(length(email) <= 100),
    message TEXT NOT NULL CHECK(length(message) <= 1000),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Design Notes:**
- Stores all contact form submissions
- No sensitive data (no passwords/tokens)
- Email validation at application layer
- Timestamp for response time tracking

### Normalization Considerations
- **Current**: 3NF (no redundant data)
- **Tradeoff**: `tech_stack` is denormalized (comma-separated string)
- **Alternative**: Separate `technologies` table with many-to-many
- **Decision**: Simplicity over query flexibility for this use case

## API Documentation

### GET /api/projects
Retrieves all portfolio projects.

**Response:**
```json
{
  "projects": [
    {
      "id": 1,
      "title": "Project Title",
      "description": "Problem statement and technical approach...",
      "tech_stack": "Python, Flask, PostgreSQL",
      "github_url": "https://github.com/username/project"
    }
  ]
}
```

**Status Codes:**
- `200 OK`: Success
- `500 Internal Server Error`: Database error

### POST /api/projects
Creates a new project.

**Request:**
```json
{
  "title": "New Project",
  "description": "Description here...",
  "tech_stack": "Python, Flask, SQL",
  "github_url": "https://github.com/..." // optional
}
```

**Response:**
```json
{
  "message": "Project created successfully",
  "project_id": 5
}
```

**Status Codes:**
- `201 Created`: Success
- `400 Bad Request`: Validation error
- `500 Internal Server Error`: Database error

### POST /api/contact
Submits a contact form message.

**Request:**
```json
{
  "name": "Full Name",
  "email": "email@example.com",
  "message": "Your message here..."
}
```

**Response:**
```json
{
  "message": "Contact form submitted successfully",
  "contact_id": 12
}
```

**Status Codes:**
- `201 Created`: Success
- `400 Bad Request`: Validation error
- `500 Internal Server Error`: Database error

## Local Development Setup

### Prerequisites
- Python 3.10 or higher
- pip (Python package manager)
- Git

### Backend Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/personal-portfolio.git
   cd personal-portfolio/backend
   ```

2. **Create virtual environment**
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

4. **Initialize database**
   ```bash
   python db.py
   ```

5. **Run development server**
   ```bash
   python app.py
   ```
   Backend will run at `http://localhost:5000`

### Frontend Setup

1. **Navigate to frontend directory**
   ```bash
   cd ../frontend
   ```

2. **Update API URL**
   - Open `js/main.js`
   - Set `API_BASE_URL` to `'http://localhost:5000'`

3. **Serve frontend**
   ```bash
   # Option 1: Python's built-in server
   python -m http.server 8000

   # Option 2: VS Code Live Server extension
   # Right-click index.html → "Open with Live Server"
   ```
   Frontend will run at `http://localhost:8000`

### Testing the Application

1. Visit `http://localhost:8000` to see the home page
2. Navigate to Projects page to see API data loading
3. Test contact form submission
4. Use admin panel to add new projects

## Deployment

### Frontend Deployment (GitHub Pages)

1. **Create GitHub repository**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/yourusername/portfolio.git
   git push -u origin main
   ```

2. **Enable GitHub Pages**
   - Go to repository Settings → Pages
   - Source: Deploy from branch `main`
   - Folder: `/frontend` or root (move frontend files to root)
   - Save

3. **Update API URL**
   - In `frontend/js/main.js`, change `API_BASE_URL` to your backend URL
   - Commit and push changes

### Backend Deployment (Render)

1. **Create Render account** at https://render.com

2. **Create new Web Service**
   - Connect your GitHub repository
   - Root directory: `backend`
   - Build command: `pip install -r requirements.txt`
   - Start command: `gunicorn app:app`

3. **Add environment variables**
   ```
   FLASK_ENV=production
   DATABASE_URL=(Render will provide if using PostgreSQL)
   ```

4. **Create PostgreSQL database** (optional)
   - Create new PostgreSQL database in Render
   - Copy database URL to `DATABASE_URL` environment variable
   - Update `app.py` and `db.py` to use PostgreSQL connection

5. **Deploy**
   - Render will automatically deploy on push to main branch

### Backend Deployment (Fly.io)

1. **Install Fly CLI**
   ```bash
   curl -L https://fly.io/install.sh | sh
   ```

2. **Login and launch**
   ```bash
   fly auth login
   cd backend
   fly launch
   ```

3. **Configure app**
   - Choose app name
   - Select region
   - Don't create database yet (use SQLite or provision PostgreSQL)

4. **Set environment variables**
   ```bash
   fly secrets set FLASK_ENV=production
   ```

5. **Deploy**
   ```bash
   fly deploy
   ```

### Post-Deployment Checklist

- [ ] Frontend accessible via HTTPS
- [ ] Backend API returns 200 on `/api/health`
- [ ] Projects load on Projects page
- [ ] Contact form submissions work
- [ ] Admin panel can create projects
- [ ] CORS configured correctly
- [ ] All links updated to production URLs

## Code Quality Features

### Security Practices
- **Parameterized SQL queries**: Prevents SQL injection
- **Input validation**: Server-side validation on all endpoints
- **Length constraints**: Database-level checks prevent overflow
- **CORS configuration**: Restricts API access to known origins
- **No secrets in code**: Environment-based configuration

### Error Handling
- **Try-catch blocks**: All database operations wrapped
- **Proper HTTP codes**: 200, 201, 400, 500 used correctly
- **User-friendly messages**: Clear error responses
- **Server logging**: Errors logged for debugging

### Code Organization
- **Modular design**: `app.py`, `db.py` separation
- **Single responsibility**: Each function has one job
- **Clear naming**: Variables and functions are self-documenting
- **Comments**: Explain "why", not just "what"

## Future Improvements

### Security Enhancements
- [ ] Add JWT authentication for admin panel
- [ ] Implement rate limiting on API endpoints
- [ ] Add CSRF protection for state-changing operations
- [ ] Use environment-specific CORS origins (not wildcard)
- [ ] Implement API key authentication

### Features
- [ ] Admin dashboard to view contact submissions
- [ ] Project categories/tags for better organization
- [ ] Image uploads for project screenshots
- [ ] Resume download functionality
- [ ] Blog section with Markdown support
- [ ] Search/filter functionality for projects

### Performance
- [ ] Implement database connection pooling
- [ ] Add Redis caching for project listings
- [ ] Optimize images with lazy loading
- [ ] Add database query result pagination
- [ ] Implement CDN for static assets

### Testing
- [ ] Write unit tests with pytest
- [ ] Add integration tests for API endpoints
- [ ] Implement CI/CD pipeline (GitHub Actions)
- [ ] Add frontend JavaScript tests
- [ ] Set up test coverage reporting

### Monitoring
- [ ] Add application performance monitoring (APM)
- [ ] Set up error tracking (Sentry)
- [ ] Implement logging aggregation
- [ ] Create uptime monitoring
- [ ] Add database query performance tracking

## Project Structure

```
personal-portfolio/
│
├── frontend/
│   ├── index.html              # Home page
│   ├── projects.html           # Projects page (dynamic data)
│   ├── contact.html            # Contact form
│   ├── admin.html              # Admin panel
│   ├── css/
│   │   └── styles.css          # All styles (Flexbox/Grid)
│   └── js/
│       └── main.js             # API client, form handling
│
├── backend/
│   ├── app.py                  # Flask application & routes
│   ├── db.py                   # Database operations
│   ├── schema.sql              # SQL schema documentation
│   ├── requirements.txt        # Python dependencies
│   └── portfolio.db            # SQLite database (gitignored)
│
├── README.md                   # This file
└── .gitignore                  # Git ignore rules
```

## Technologies Justification

### Why Flask over Django?
- **Lightweight**: Only need API endpoints, not full framework
- **Flexibility**: More control over architecture
- **Learning**: Demonstrates understanding of web fundamentals
- **Deployment**: Smaller footprint, faster cold starts

### Why Vanilla JavaScript over React?
- **No build process**: Simpler deployment
- **Performance**: No framework overhead
- **Skills**: Shows DOM manipulation competency
- **Portfolio context**: Appropriate for project scale

### Why SQLite → PostgreSQL?
- **Development**: SQLite for local, no setup required
- **Production**: PostgreSQL for scalability and features
- **Migration path**: Demonstrates infrastructure thinking
- **Cost**: Free tier available on Render

### Why GitHub Pages?
- **Free**: No hosting costs
- **Fast**: CDN-backed
- **Simple**: Git push to deploy
- **Professional**: Custom domain support

## Contributing

This is a personal portfolio project, but feedback is welcome! If you notice any issues or have suggestions:

1. Open an issue describing the problem or suggestion
2. For code contributions, fork the repository and submit a pull request
3. Ensure code follows existing style and includes comments

## License

This project is open source and available under the MIT License. Feel free to use this as a template for your own portfolio.

## Contact

**Konstantin Shtop**  
Email: konstantin.shtop@gmail.com 
LinkedIn: [https://www.linkedin.com/in/konstantin-shtop-529277327/]  
GitHub: [@Konstantin-S06](https://github.com/Konstantin-S06)

---

**Built with ❤️ and clean code principles**