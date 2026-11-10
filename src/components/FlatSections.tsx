import { remainingProjects, type Chapter } from '../chapters';
import type { Project } from '../lib/projects';
import { ChapterContent } from './ChapterContent';

/** Fallback layout: same chapters as ordinary document sections, in source order, no canvas. */
export function FlatSections({ chapters, projects }: { chapters: Chapter[]; projects: Project[] }) {
  const firstProjectId = chapters.find((c) => c.kind === 'project')?.id;
  const contactId = chapters.find((c) => c.kind === 'cta')?.id ?? 'connect';
  const projectTotal = chapters.filter((c) => c.kind === 'project').length;
  let projectNo = 0;
  const moreProjects = remainingProjects(chapters, projects);

  return (
    <>
      {chapters.map((c) => {
        const projectIndex = c.kind === 'project' ? ++projectNo : undefined;
        return (
          <section key={c.id} id={c.id} className={c.kind}>
            <ChapterContent
              kind={c.kind}
              title={c.title}
              project={c.projectId !== undefined ? projects.find((p) => p.id === c.projectId) : undefined}
              actions={{
                pinned: false,
                firstProjectId,
                contactId,
                projectIndex,
                projectTotal,
                moreProjects,
                onNavigate: () => {},
              }}
            />
          </section>
        );
      })}
    </>
  );
}
