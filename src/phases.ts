import type { Status } from './models';

/** Phase names are compared ignoring surrounding spaces and capitalization. */
export function phaseKey(label: string) {
  return label.trim().toLocaleLowerCase('es-MX');
}

/** Returns the first label that repeats another one, or undefined when all are distinct. */
export function findDuplicatePhase(labels: string[]) {
  const seen = new Set<string>();
  for (const label of labels) {
    const key = phaseKey(label);
    if (seen.has(key)) {
      return label;
    }
    seen.add(key);
  }
  return undefined;
}

export type PhaseRename = { from: Status; to: string; taskCount: number };

export type PhaseEditResult = {
  statuses: Status[];
  completedStatusId: string;
  /** Where actions of a removed phase go: the first kept phase that is not the completed one. */
  fallbackStatusId: string;
};

export type PhaseEditPlan = {
  /** Phases with actions whose name changed in place; only the person can tell a rename from a replacement. */
  ambiguousRenames: PhaseRename[];
  apply: (treatAsRenames: boolean) => PhaseEditResult;
};

/**
 * Plans how an edited, comma separated phase list maps onto the current
 * phases. Matching names keep their phase. A new name that takes the exact
 * position of a removed name may be a rename; when that phase has actions the
 * caller must ask, otherwise its actions would silently change phase.
 */
export function planPhaseEdit({
  current,
  labels,
  completedLabel,
  taskCounts,
  newId,
  colors,
}: {
  current: Status[];
  labels: string[];
  completedLabel: string;
  taskCounts: Record<string, number>;
  newId: () => string;
  colors: string[];
}): PhaseEditPlan {
  const newKeys = new Set(labels.map(phaseKey));
  const matched = labels.map((label) => current.find((status) => phaseKey(status.label) === phaseKey(label)));
  const renameAt = labels.map((label, index) => {
    const previous = current[index];
    return !matched[index] && previous && !newKeys.has(phaseKey(previous.label))
      ? { from: previous, to: label, taskCount: taskCounts[previous.id] || 0 }
      : undefined;
  });

  return {
    ambiguousRenames: renameAt.filter(
      (rename): rename is PhaseRename => Boolean(rename && rename.taskCount > 0),
    ),
    apply(treatAsRenames) {
      const built = labels.map((label, index) => {
        const reused = matched[index];
        if (reused) {
          return { status: { ...reused, label }, kept: true };
        }
        const rename = renameAt[index];
        if (rename && (rename.taskCount === 0 || treatAsRenames)) {
          return { status: { ...rename.from, label }, kept: true };
        }
        return {
          status: { id: newId(), label, color: colors[index % colors.length] },
          kept: false,
        };
      });

      const completed =
        built.find(({ status }) => phaseKey(status.label) === phaseKey(completedLabel)) ||
        built[built.length - 1];
      const ordered = [...built.filter((item) => item !== completed), completed];
      const fallback =
        ordered.find((item) => item.kept && item !== completed) ||
        ordered.find((item) => item !== completed) ||
        ordered[0];

      return {
        statuses: ordered.map(({ status }) => status),
        completedStatusId: completed.status.id,
        fallbackStatusId: fallback.status.id,
      };
    },
  };
}
