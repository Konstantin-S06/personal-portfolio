import { techTags, type Project } from '../lib/projects';

function Links({ project }: { project: Project }) {
  if (!project.github_url && !project.demo_url) return null;
  return (
    <div className="project-links">
      {project.github_url && (
        <a className="project-link" href={project.github_url} target="_blank" rel="noopener noreferrer">GitHub</a>
      )}
      {project.demo_url && (
        <a className="project-link" href={project.demo_url} target="_blank" rel="noopener noreferrer">Live demo</a>
      )}
    </div>
  );
}

function Tags({ stack }: { stack: string }) {
  return (
    <div className="project-tech">
      {techTags(stack).map((t) => <span className="tech-tag" key={t}>{t}</span>)}
    </div>
  );
}

/** Full chapter content for one featured project. `highlightLimit` keeps the first N bullets (pinned walk). */
export function ProjectPanel({
  project,
  index,
  total,
  highlightLimit,
}: {
  project: Project;
  index: number;
  total: number;
  highlightLimit?: number;
}) {
  const highlights = highlightLimit ? project.highlights.slice(0, highlightLimit) : project.highlights;
  return (
    <div className="container project-panel">
      <div className="project-meta">
        <span>Project {index} of {total}</span>
        <span className="project-dots" aria-hidden="true">
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className={i === index - 1 ? 'dot on' : 'dot'} />
          ))}
        </span>
      </div>
      <h2>{project.title}</h2>
      {project.context && <p className="project-context">{project.context}</p>}
      {/* Fall back to the full write-up for legacy rows that have no summary. */}
      <p className="project-summary">{project.summary ?? project.description}</p>
      {project.role && <p className="project-role"><strong>Role:</strong> {project.role}</p>}
      {highlights.length > 0 && (
        <ul className="project-highlights">
          {highlights.map((h) => <li key={h}>{h}</li>)}
        </ul>
      )}
      <Tags stack={project.tech_stack} />
      <Links project={project} />
    </div>
  );
}

/** Compact card for the "More projects" grid. */
export function ProjectCard({ project }: { project: Project }) {
  return (
    <article className="project-card">
      <h3>{project.title}</h3>
      {project.context && <p className="project-context">{project.context}</p>}
      <p>{project.summary ?? project.description}</p>
      <Tags stack={project.tech_stack} />
      <Links project={project} />
    </article>
  );
}

/** Every project without its own chapter (non-featured, or featured beyond the available seats), after the path. */
export function MoreProjects({ projects, shown }: { projects: Project[]; shown: Set<number> }) {
  const rest = projects.filter((p) => !shown.has(p.id)).sort((a, b) => a.sort_order - b.sort_order);
  if (rest.length === 0) return null;
  return (
    <section id="more-projects" className="more-projects">
      <div className="container">
        <h2>More projects</h2>
        <div className="projects-grid">
          {rest.map((p) => <ProjectCard key={p.id} project={p} />)}
        </div>
      </div>
    </section>
  );
}
