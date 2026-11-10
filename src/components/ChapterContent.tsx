import type { CSSProperties, MouseEvent } from 'react';
import type { ChapterKind } from '../chapters';
import { techStack } from '../data/techstack';
import type { Project } from '../lib/projects';
import { ContactForm } from './ContactForm';
import { MoreArc } from './MoreArc';
import { ProjectPanel } from './ProjectPanel';

export interface ChapterActions {
  pinned: boolean;
  firstProjectId?: string;
  contactId: string;
  projectIndex?: number;
  projectTotal: number;
  moreProjects?: Project[];
  onNavigate: (id: string) => void;
}

function go(e: MouseEvent<HTMLAnchorElement>, pinned: boolean, id: string | undefined, onNavigate: (id: string) => void) {
  if (!pinned || !id) return;
  e.preventDefault();
  onNavigate(id);
}

export function ChapterContent({
  kind,
  title,
  project,
  actions,
}: {
  kind: ChapterKind;
  title: string;
  project?: Project;
  actions: ChapterActions;
}) {
  switch (kind) {
    case 'project':
      return project && actions.projectIndex ? (
        <ProjectPanel
          project={project}
          index={actions.projectIndex}
          total={actions.projectTotal}
          highlightLimit={actions.pinned ? 3 : undefined}
        />
      ) : null;
    case 'hero': {
      const projectHref = actions.firstProjectId ? `#${actions.firstProjectId}` : '#more-projects';
      return (
        <div className="container hero-copy">
          <p className="hero-kicker">Computer Science Co-op · University of Toronto</p>
          <h1 className="hero-title">Konstantin Shtop</h1>
          <p className="hero-tagline">
            I'm a computer science student who prefers to work on the backend: APIs, databases
            and the logic behind an app.
          </p>
          <p className="hero-tagline">
            Right now I'm a Software Developer intern at Environment and Climate Change Canada
            a Software Engineer on the UofTHacks team, and an Undergraduate AI Research Assistant in the Department of Computer Science at the University of Toronto. 
          </p>
          <p className="hero-description">
          Scroll to walk through some of what I've built.
          </p>
          <div className="hero-actions">
            <a
              className="btn-primary"
              href={projectHref}
              onClick={(e) => go(e, actions.pinned, actions.firstProjectId, actions.onNavigate)}
            >
              Start the walk
            </a>
            <a
              className="btn-secondary"
              href={`#${actions.contactId}`}
              onClick={(e) => go(e, actions.pinned, actions.contactId, actions.onNavigate)}
            >
              Get in touch
            </a>
          </div>
          {actions.pinned && <p className="scroll-hint">Scroll to walk forward</p>}
        </div>
      );
    }
    case 'about':
      return (
        <div className="container about-copy">
          <h2>{title}</h2>
          <p className="hero-tagline">
          Outside of software, I'm usually playing volleyball, gaming, or exploring game development. I'm a big fan of Souls games, particularly Dark Souls III and Elden Ring, and have spent some time making smaller games in Unity and Roblox Studio.</p>
          <p className="hero-tagline">
          I'm always up for trying something new, meeting interesting people, or working on a cool project!
          </p>
        </div>
      );
    case 'tech': {
      let chip = 0;
      return (
        <div className="container">
          <div className="tech-panel">
            <h2>{title}</h2>
            {techStack.map((group) => (
              <div className="tech-row" key={group.label}>
                <div className="tech-label">{group.label}</div>
                <div className="tech-chips">
                  {group.items.map((item) => {
                    const style = { '--chip': chip } as CSSProperties;
                    chip += 1;
                    return (
                      <span className="tech-chip" key={item} style={style}>
                        {item}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }
    case 'more':
      return <MoreArc title={title} projects={actions.moreProjects ?? []} />;
    case 'cta':
      return (
        <div className="container">
          <div className="contact-card">
            <h2>{title}</h2>
            <p className="contact-lead">Interested in working together or discussing opportunities?</p>
            <ContactForm />
            <div className="contact-links">
              <a href="mailto:konstantin.shtop@gmail.com">Email</a>
              <a href="https://github.com/Konstantin-S06" target="_blank" rel="noopener noreferrer">GitHub</a>
              <a href="https://linkedin.com/in/konstantin-shtop-529277327/" target="_blank" rel="noopener noreferrer">LinkedIn</a>
            </div>
          </div>
        </div>
      );
  }
}
