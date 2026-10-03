import type { Action } from './models';

export type ActionEffectDeps = {
  /** Creates or updates the device calendar event. Returns the references to keep. */
  syncCalendar: (action: Action) => Promise<{ id?: string; calendarId?: string }>;
  /** Removes the device calendar event of an action. May throw. */
  removeCalendar: (action: Action) => Promise<void>;
  scheduleReminder: (action: Action) => Promise<string | undefined>;
  cancelReminder: (notificationId?: string) => Promise<void>;
};

export type ActionEffectResult =
  | { ok: true; action: Action; calendarFailed: boolean }
  | { ok: false; message: string };

/**
 * Applies the calendar and reminder side effects for a saved action.
 *
 * The calendar runs first because it is the step that can abort the save.
 * Reminders are only touched once the save is certain to happen, so a failure
 * never leaves a scheduled reminder that the saved data does not know about,
 * nor cancels the reminder of an action that stays unchanged.
 */
export async function applyActionEffects(
  previous: Action | undefined,
  next: Action,
  deps: ActionEffectDeps,
): Promise<ActionEffectResult> {
  const action: Action = { ...next, notificationId: undefined };
  let calendarFailed = false;

  if (!action.dueDate && previous?.calendarEventId) {
    try {
      await deps.removeCalendar(previous);
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error && error.message
            ? error.message
            : 'Comprueba que el calendario siga disponible antes de quitar la fecha.',
      };
    }
    action.calendarEventId = undefined;
    action.calendarEventCalendarId = undefined;
    action.calendarInviteeEmails = [];
  } else {
    try {
      const synced = await deps.syncCalendar(action);
      action.calendarEventId = synced.id;
      action.calendarEventCalendarId = synced.calendarId;
    } catch {
      // Keep the existing references so the event can still be updated or removed later.
      calendarFailed = true;
      action.calendarEventId = previous?.calendarEventId;
      action.calendarEventCalendarId = previous?.calendarEventCalendarId;
      action.calendarInviteeEmails = previous?.calendarInviteeEmails;
    }
  }

  try {
    await deps.cancelReminder(previous?.notificationId);
  } catch {
    // The reminder may already have fired or been removed by the device.
  }
  try {
    action.notificationId = await deps.scheduleReminder(action);
  } catch {
    action.notificationId = undefined;
  }

  return { ok: true, action, calendarFailed };
}
