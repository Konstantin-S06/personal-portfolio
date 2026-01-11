/**
 * Main JavaScript for Portfolio Frontend
 * 
 * Handles all API interactions with the Flask backend.
 * Uses fetch API for all HTTP requests with proper error handling.
 * 
 * Configuration is environment-aware:
 * - Production: API_BASE_URL points to deployed backend
 * - Local: API_BASE_URL points to localhost:5000
 */

// ===========================
// CONFIGURATION
// ===========================

// Change this URL based on your deployment
// For local development: 'http://localhost:5000'
// For production: 'https://your-backend.onrender.com' or your Fly.io URL
const API_BASE_URL = 'https://konstantins-portfolio.onrender.com';

// ===========================
// PROJECTS FUNCTIONS
// ===========================

/**
 * Fetches all projects from the backend API
 * Handles loading, error, and empty states
 */
async function loadProjects() {
    const loading = document.getElementById('loading');
    const error = document.getElementById('error');
    const container = document.getElementById('projects-container');
    const emptyState = document.getElementById('empty-state');
    
    try {
        // Show loading state
        if (loading) loading.style.display = 'block';
        if (error) error.style.display = 'none';
        if (emptyState) emptyState.style.display = 'none';
        
        const response = await fetch(`${API_BASE_URL}/api/projects`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Hide loading state
        if (loading) loading.style.display = 'none';
        
        if (data.projects && data.projects.length > 0) {
            // Render projects
            renderProjects(data.projects, container);
        } else {
            // Show empty state
            if (emptyState) emptyState.style.display = 'block';
        }
        
    } catch (err) {
        console.error('Error loading projects:', err);
        if (loading) loading.style.display = 'none';
        if (error) error.style.display = 'block';
    }
}

/**
 * Renders projects to the DOM
 * @param {Array} projects - Array of project objects
 * @param {HTMLElement} container - Container element to render into
 */
function renderProjects(projects, container) {
    if (!container) return;
    
    container.innerHTML = '';
    
    projects.forEach(project => {
        const card = createProjectCard(project);
        container.appendChild(card);
    });
}

/**
 * Creates a project card DOM element
 * @param {Object} project - Project data object
 * @returns {HTMLElement} Project card element
 */
function createProjectCard(project) {
    const card = document.createElement('div');
    card.className = 'project-card';
    
    const title = document.createElement('h3');
    title.textContent = project.title;
    
    const description = document.createElement('p');
    description.textContent = project.description;
    
    // Parse tech stack (comma-separated string) into tags
    const techContainer = document.createElement('div');
    techContainer.className = 'project-tech';
    
    if (project.tech_stack) {
        const techs = project.tech_stack.split(',').map(t => t.trim());
        techs.forEach(tech => {
            const tag = document.createElement('span');
            tag.className = 'tech-tag';
            tag.textContent = tech;
            techContainer.appendChild(tag);
        });
    }
    
    card.appendChild(title);
    card.appendChild(description);
    card.appendChild(techContainer);
    
    // Add GitHub link if available
    if (project.github_url) {
        const link = document.createElement('a');
        link.href = project.github_url;
        link.textContent = 'View on GitHub →';
        link.className = 'project-link';
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        card.appendChild(link);
    }
    
    return card;
}

/**
 * Submits a new project to the backend API
 * Called from admin page
 */
async function submitProject() {
    const title = document.getElementById('project-title').value.trim();
    const description = document.getElementById('project-description').value.trim();
    const techStack = document.getElementById('project-tech').value.trim();
    const githubUrl = document.getElementById('project-github').value.trim();
    
    const messageDiv = document.getElementById('admin-message');
    const submitBtn = document.getElementById('submit-project-btn');
    
    // Client-side validation
    if (!title || !description || !techStack) {
        showMessage(messageDiv, 'Please fill in all required fields.', 'error');
        return;
    }
    
    // Validate GitHub URL format if provided
    if (githubUrl && !isValidUrl(githubUrl)) {
        showMessage(messageDiv, 'Please enter a valid GitHub URL.', 'error');
        return;
    }
    
    try {
        // Disable submit button to prevent double submission
        submitBtn.disabled = true;
        submitBtn.textContent = 'Adding Project...';
        
        const response = await fetch(`${API_BASE_URL}/api/projects`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                title: title,
                description: description,
                tech_stack: techStack,
                github_url: githubUrl || null
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showMessage(messageDiv, 'Project added successfully!', 'success');
            // Clear form
            document.getElementById('project-title').value = '';
            document.getElementById('project-description').value = '';
            document.getElementById('project-tech').value = '';
            document.getElementById('project-github').value = '';
        } else {
            showMessage(messageDiv, data.error || 'Failed to add project.', 'error');
        }
        
    } catch (err) {
        console.error('Error submitting project:', err);
        showMessage(messageDiv, 'Network error. Please check your connection and try again.', 'error');
    } finally {
        // Re-enable submit button
        submitBtn.disabled = false;
        submitBtn.textContent = 'Add Project';
    }
}

// ===========================
// CONTACT FUNCTIONS
// ===========================

/**
 * Submits contact form to backend API
 * Stores message in database
 */
async function submitContactForm() {
    const name = document.getElementById('name').value.trim();
    const email = document.getElementById('email').value.trim();
    const message = document.getElementById('message').value.trim();
    
    const messageDiv = document.getElementById('form-message');
    const submitBtn = document.getElementById('submit-btn');
    
    // Client-side validation
    if (!name || !email || !message) {
        showMessage(messageDiv, 'Please fill in all fields.', 'error');
        return;
    }
    
    if (!isValidEmail(email)) {
        showMessage(messageDiv, 'Please enter a valid email address.', 'error');
        return;
    }
    
    try {
        // Disable submit button
        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending...';
        
        const response = await fetch(`${API_BASE_URL}/api/contact`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: name,
                email: email,
                message: message
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showMessage(messageDiv, 'Message sent successfully! I\'ll get back to you soon.', 'success');
            // Clear form
            document.getElementById('name').value = '';
            document.getElementById('email').value = '';
            document.getElementById('message').value = '';
        } else {
            showMessage(messageDiv, data.error || 'Failed to send message.', 'error');
        }
        
    } catch (err) {
        console.error('Error submitting contact form:', err);
        showMessage(messageDiv, 'Network error. Please check your connection and try again.', 'error');
    } finally {
        // Re-enable submit button
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send Message';
    }
}

// ===========================
// UTILITY FUNCTIONS
// ===========================

/**
 * Displays a message to the user
 * @param {HTMLElement} element - Message container element
 * @param {string} text - Message text
 * @param {string} type - Message type ('success' or 'error')
 */
function showMessage(element, text, type) {
    if (!element) return;
    
    element.textContent = text;
    element.className = `form-message ${type}`;
    element.style.display = 'block';
    
    // Auto-hide success messages after 5 seconds
    if (type === 'success') {
        setTimeout(() => {
            element.style.display = 'none';
        }, 5000);
    }
}

/**
 * Validates email format
 * @param {string} email - Email address to validate
 * @returns {boolean} True if valid email format
 */
function isValidEmail(email) {
    // Basic email validation regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

/**
 * Validates URL format
 * @param {string} url - URL to validate
 * @returns {boolean} True if valid URL format
 */
function isValidUrl(url) {
    try {
        new URL(url);
        return true;
    } catch (err) {
        return false;
    }
}

// ===========================
// EXPORTS
// ===========================

// Make functions available globally for onclick handlers
window.loadProjects = loadProjects;
window.submitProject = submitProject;
window.submitContactForm = submitContactForm;