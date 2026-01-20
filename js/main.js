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
    const projectDateEl = document.getElementById('project-date');
    const projectDate = projectDateEl ? projectDateEl.value.trim() : '';
    const editingIdEl = document.getElementById('editing-project-id');
    const editingProjectId = editingIdEl ? editingIdEl.value.trim() : '';
    
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
        submitBtn.textContent = editingProjectId ? 'Saving Changes...' : 'Adding Project...';

        const adminToken = sessionStorage.getItem('admin_token') || '';
        const headers = {
            'Content-Type': 'application/json',
            'X-Admin-Token': adminToken
        };
        
        const url = editingProjectId
            ? `${API_BASE_URL}/api/projects/${editingProjectId}`
            : `${API_BASE_URL}/api/projects`;

        const method = editingProjectId ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method,
            headers,
            body: JSON.stringify({
                title: title,
                description: description,
                tech_stack: techStack,
                project_date: projectDate || null,
                github_url: githubUrl || null
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showMessage(messageDiv, editingProjectId ? 'Project updated successfully!' : 'Project added successfully!', 'success');
            // Clear form / exit edit mode
            cancelEdit(true);
            // Reload projects list if on admin page
            if (typeof loadAdminProjects === 'function') {
                loadAdminProjects();
            }
        } else {
            showMessage(messageDiv, data.error || 'Failed to add project.', 'error');
        }
        
    } catch (err) {
        console.error('Error submitting project:', err);
        showMessage(messageDiv, 'Network error. Please check your connection and try again.', 'error');
    } finally {
        // Re-enable submit button
        submitBtn.disabled = false;
        const currentEditingIdEl = document.getElementById('editing-project-id');
        const currentEditingId = currentEditingIdEl ? currentEditingIdEl.value.trim() : '';
        submitBtn.textContent = currentEditingId ? 'Save Changes' : 'Add Project';
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

/**
 * Loads projects for admin page with delete functionality
 */
async function loadAdminProjects() {
    const container = document.getElementById('projects-list-container');
    const messageDiv = document.getElementById('projects-list-message');
    
    if (!container) return;
    
    try {
        container.innerHTML = '<p>Loading projects...</p>';
        
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
        
        if (data.projects && data.projects.length > 0) {
            container.innerHTML = '';
            
            data.projects.forEach(project => {
                const projectDiv = document.createElement('div');
                projectDiv.className = 'admin-project-item';
                projectDiv.style.cssText = 'border: 1px solid #e5e7eb; padding: 1rem; margin-bottom: 1rem; border-radius: 8px; display: flex; justify-content: space-between; align-items: start;';
                
                const projectInfo = document.createElement('div');
                projectInfo.style.cssText = 'flex: 1;';
                
                const title = document.createElement('h3');
                title.textContent = project.title;
                title.style.cssText = 'margin: 0 0 0.5rem 0; font-size: 1.125rem;';
                
                const description = document.createElement('p');
                description.textContent = project.description.length > 150 
                    ? project.description.substring(0, 150) + '...' 
                    : project.description;
                description.style.cssText = 'margin: 0 0 0.5rem 0; color: #6b7280; font-size: 0.875rem;';
                
                const techStack = document.createElement('p');
                techStack.textContent = `Tech: ${project.tech_stack}`;
                techStack.style.cssText = 'margin: 0; color: #6b7280; font-size: 0.875rem;';

                const projectDate = document.createElement('p');
                projectDate.textContent = `Date: ${project.project_date || '—'}`;
                projectDate.style.cssText = 'margin: 0.25rem 0 0 0; color: #6b7280; font-size: 0.875rem;';
                
                projectInfo.appendChild(title);
                projectInfo.appendChild(description);
                projectInfo.appendChild(techStack);
                projectInfo.appendChild(projectDate);
                
                const actions = document.createElement('div');
                actions.style.cssText = 'display:flex; gap:0.5rem; margin-left:1rem;';

                const editBtn = document.createElement('button');
                editBtn.textContent = 'Edit';
                editBtn.className = 'btn-primary';
                editBtn.style.cssText = 'background: #2563eb; padding: 0.5rem 1rem;';
                editBtn.onclick = () => startEdit(project);

                const deleteBtn = document.createElement('button');
                deleteBtn.textContent = 'Delete';
                deleteBtn.className = 'btn-primary';
                deleteBtn.style.cssText = 'background: #ef4444; padding: 0.5rem 1rem;';
                deleteBtn.onclick = () => deleteProject(project.id, project.title);

                actions.appendChild(editBtn);
                actions.appendChild(deleteBtn);
                
                projectDiv.appendChild(projectInfo);
                projectDiv.appendChild(actions);
                container.appendChild(projectDiv);
            });
        } else {
            container.innerHTML = '<p>No projects yet. Add one below!</p>';
        }
        
    } catch (err) {
        console.error('Error loading projects:', err);
        container.innerHTML = '<p style="color: #ef4444;">Error loading projects. Please try again.</p>';
    }
}

/**
 * Deletes a project by ID
 */
async function deleteProject(projectId, projectTitle) {
    if (!confirm(`Are you sure you want to delete "${projectTitle}"? This action cannot be undone.`)) {
        return;
    }
    
    const messageDiv = document.getElementById('projects-list-message');
    const container = document.getElementById('projects-list-container');
    
    try {
        const adminToken = sessionStorage.getItem('admin_token') || '';
        const response = await fetch(`${API_BASE_URL}/api/projects/${projectId}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'X-Admin-Token': adminToken
            }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showMessage(messageDiv, 'Project deleted successfully!', 'success');
            // Reload the projects list
            loadAdminProjects();
        } else {
            showMessage(messageDiv, data.error || 'Failed to delete project.', 'error');
        }
        
    } catch (err) {
        console.error('Error deleting project:', err);
        showMessage(messageDiv, 'Network error. Please check your connection and try again.', 'error');
    }
}

function startEdit(project) {
    const formTitle = document.getElementById('admin-form-title');
    const editingIdEl = document.getElementById('editing-project-id');
    const cancelBtn = document.getElementById('cancel-edit-btn');
    const submitBtn = document.getElementById('submit-project-btn');

    if (formTitle) formTitle.textContent = 'Edit Project';
    if (editingIdEl) editingIdEl.value = project.id;
    if (cancelBtn) cancelBtn.style.display = 'inline-block';
    if (submitBtn) submitBtn.textContent = 'Save Changes';

    document.getElementById('project-title').value = project.title || '';
    document.getElementById('project-description').value = project.description || '';
    document.getElementById('project-tech').value = project.tech_stack || '';
    document.getElementById('project-github').value = project.github_url || '';

    const dateEl = document.getElementById('project-date');
    if (dateEl) dateEl.value = project.project_date || '';

    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}

function cancelEdit(silent = false) {
    const formTitle = document.getElementById('admin-form-title');
    const editingIdEl = document.getElementById('editing-project-id');
    const cancelBtn = document.getElementById('cancel-edit-btn');
    const submitBtn = document.getElementById('submit-project-btn');

    if (formTitle) formTitle.textContent = 'Add New Project';
    if (editingIdEl) editingIdEl.value = '';
    if (cancelBtn) cancelBtn.style.display = 'none';
    if (submitBtn) submitBtn.textContent = 'Add Project';

    // Clear form
    const ids = ['project-title', 'project-description', 'project-tech', 'project-github', 'project-date'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });

    if (!silent) {
        const messageDiv = document.getElementById('admin-message');
        if (messageDiv) messageDiv.style.display = 'none';
    }
}

// Make functions available globally for onclick handlers
window.loadProjects = loadProjects;
window.loadAdminProjects = loadAdminProjects;
window.submitProject = submitProject;
window.submitContactForm = submitContactForm;
window.deleteProject = deleteProject;
window.startEdit = startEdit;
window.cancelEdit = cancelEdit;