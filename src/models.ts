export type Status = {
  id: string;
  label: string;
  color: string;
};

export type Action = {
  id: string;
  title: string;
  dueDate?: string;
  dueTime?: string;
  observations?: string;
  statusId: string;
  reminder: boolean;
  reminderMinutes?: number;
  notificationId?: string;
  calendarEventId?: string;
  calendarEventCalendarId?: string;
  calendarInviteeEmails?: string[];
  inviteeIds?: string[];
  updatedAt: string;
};

export type Contact = {
  id: string;
  name: string;
  email: string;
  updatedAt: string;
};

export type CalendarChoice = {
  id: string;
  title: string;
  account?: string;
  isPrimary?: boolean;
};

export type Project = {
  id: string;
  title: string;
  description?: string;
  statuses: Status[];
  completedStatusId: string;
  useGoogleCalendar: boolean;
  calendarId?: string;
  calendarTitle?: string;
  calendarAccount?: string;
  actions: Action[];
};

export type AppData = {
  projects: Project[];
  contacts: Contact[];
};
