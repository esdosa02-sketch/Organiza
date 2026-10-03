import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Calendar from 'expo-calendar';
import { cancelScheduledNotificationAsync } from 'expo-notifications/build/cancelScheduledNotificationAsync';
import { getPermissionsAsync, requestPermissionsAsync } from 'expo-notifications/build/NotificationPermissions';
import { setNotificationHandler } from 'expo-notifications/build/NotificationsHandler';
import { SchedulableTriggerInputTypes } from 'expo-notifications/build/Notifications.types';
import { scheduleNotificationAsync } from 'expo-notifications/build/scheduleNotificationAsync';
import { StatusBar } from 'expo-status-bar';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import type {
  Action,
  AppData,
  CalendarChoice,
  Contact,
  Project,
  Status,
} from './src/models';

type Screen =
  | { name: 'home' }
  | { name: 'project'; projectId: string }
  | { name: 'contacts' }
  | { name: 'summary' };

type ActiveModal =
  | { type: 'project' }
  | { type: 'project-settings'; projectId: string }
  | { type: 'action'; projectId: string; actionId?: string }
  | { type: 'status'; projectId: string; actionId: string }
  | { type: 'calendar'; projectId: string; mode: 'connect' | 'change' }
  | { type: 'contact'; contactId?: string }
  | null;

type QuickDate = {
  projectId: string;
  actionId: string;
  value: Date;
};

type MobileLayout = {
  compact: boolean;
  edge: number;
  tableMaxHeight: number;
  width: number;
};

type ProjectListItem = {
  project: Project;
  counts: Array<{ status: Status; count: number }>;
  state: string;
};

type SummaryPhase = {
  key: string;
  label: string;
  color: string;
};

const STORAGE_KEY = '@organiza-app/personal-table-v2';
const STATUS_COLORS = ['#F0A14A', '#5A9BD5', '#4BAF8A', '#A56ED8', '#E66F87'];
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const REMINDER_OPTIONS: Array<{ label: string; minutes: number | null }> = [
  { label: '10 min antes', minutes: 10 },
  { label: '30 min antes', minutes: 30 },
  { label: '1 hora antes', minutes: 60 },
  { label: '1 día antes', minutes: 24 * 60 },
  { label: '1 semana antes', minutes: 7 * 24 * 60 },
];
setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

function uid(prefix: string) {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/** Keeps people’s entries neat without changing the rest of what they wrote. */
function capitalizeFirst(value: string) {
  const firstCharacter = value.search(/\S/);
  if (firstCharacter < 0) {
    return value;
  }
  return (
    value.slice(0, firstCharacter) +
    value.charAt(firstCharacter).toLocaleUpperCase('es-MX') +
    value.slice(firstCharacter + 1)
  );
}

function capitalizePhaseList(value: string) {
  return value.split(',').map(capitalizeFirst).join(',');
}

function orderLabelsWithCompletedLast(labels: string[], completedLabel: string) {
  const completed = labels.find((label) => label === completedLabel);
  return completed
    ? [...labels.filter((label) => label !== completed), completed]
    : labels;
}

function phaseKey(label: string) {
  return label.trim().toLocaleLowerCase('es-MX');
}

function initialData(): AppData {
  return { projects: [], contacts: [] };
}

function normalizeData(saved: Partial<AppData> | null): AppData {
  const projects = Array.isArray(saved?.projects) ? saved.projects : [];
  const contacts = Array.isArray(saved?.contacts) ? saved.contacts : [];

  return {
    contacts: contacts.filter(
      (contact): contact is Contact =>
        Boolean(contact?.id && contact?.name && contact?.email),
    ),
    projects: projects.map((project) => ({
      ...project,
      actions: Array.isArray(project.actions)
        ? project.actions.map((action) => ({
            ...action,
            inviteeIds: Array.isArray(action.inviteeIds) ? action.inviteeIds : [],
            calendarInviteeEmails: Array.isArray(action.calendarInviteeEmails)
              ? action.calendarInviteeEmails
              : [],
          }))
        : [],
    })),
  };
}

function newDefaultStatuses(): Status[] {
  return [
    { id: uid('status'), label: 'Pendiente', color: STATUS_COLORS[0] },
    { id: uid('status'), label: 'En proceso', color: STATUS_COLORS[1] },
    { id: uid('status'), label: 'Realizada', color: STATUS_COLORS[2] },
  ];
}

function toDateKey(date: Date) {
  const padded = (value: number) => String(value).padStart(2, '0');
  return String(date.getFullYear()) + '-' + padded(date.getMonth() + 1) + '-' + padded(date.getDate());
}

function toTimeKey(date: Date) {
  const padded = (value: number) => String(value).padStart(2, '0');
  return padded(date.getHours()) + ':' + padded(date.getMinutes());
}

function fromDateKey(date?: string, time?: string) {
  if (!date) {
    return new Date();
  }
  const values = date.split('-').map(Number);
  const timeValues = time ? time.split(':').map(Number) : [9, 0];
  return new Date(values[0], values[1] - 1, values[2], timeValues[0], timeValues[1], 0);
}

function formatDate(date?: string) {
  if (!date) {
    return 'Elegir fecha';
  }
  const values = date.split('-').map(Number);
  return values[2] + ' ' + MONTHS[values[1] - 1] + ' ' + values[0];
}

function formatTime(time?: string) {
  if (!time) {
    return 'Agregar hora';
  }
  return time;
}

function formatUpdated(value: string) {
  const date = new Date(value);
  const padded = (item: number) => String(item).padStart(2, '0');
  return (
    padded(date.getDate()) +
    '/' +
    padded(date.getMonth() + 1) +
    '/' +
    String(date.getFullYear()).slice(-2) +
    ' · ' +
    padded(date.getHours()) +
    ':' +
    padded(date.getMinutes())
  );
}

function statusFor(project: Project, statusId: string) {
  return project.statuses.find((status) => status.id === statusId) || project.statuses[0];
}

function orderedStatuses(project: Project) {
  const completed = project.statuses.find((status) => status.id === project.completedStatusId);
  return completed
    ? [...project.statuses.filter((status) => status.id !== completed.id), completed]
    : project.statuses;
}

function countByStatus(project: Project) {
  return orderedStatuses(project).map((status) => ({
    status,
    count: project.actions.filter((action) => action.statusId === status.id).length,
  }));
}

function generalProjectState(project: Project) {
  if (!project.actions.length) {
    return 'Sin acciones';
  }
  const counts = countByStatus(project);
  const completed = counts.find(({ status }) => status.id === project.completedStatusId);
  if (completed && completed.count === project.actions.length) {
    return completed.status.label;
  }

  // A case cannot be complete while any action remains unfinished. This also
  // handles the requested case of many completed actions plus one pending one.
  if (completed && completed.count > 0) {
    return 'En proceso';
  }

  const nonCompletedCounts = counts.filter(({ status }) => status.id !== project.completedStatusId);
  const activePhases = nonCompletedCounts.filter(({ count }) => count > 0);
  if (activePhases.length > 1) {
    return 'En proceso';
  }
  return activePhases[0]?.status.label || nonCompletedCounts[0]?.status.label || 'En proceso';
}

/**
 * The overview must reflect each case's actual workflow, not only the three
 * default phases. Equivalent labels are grouped together, and phases marked
 * as completed remain at the end just like they do inside each case.
 */
function summaryPhasesForProjects(projects: ProjectListItem[]): SummaryPhase[] {
  const activePhases = new Map<string, SummaryPhase>();
  const completedPhases = new Map<string, SummaryPhase>();
  let fallbackColorIndex = 0;

  projects.forEach(({ project }) => {
    project.statuses.forEach((status) => {
      const key = phaseKey(status.label);
      if (!key) {
        return;
      }

      const phase: SummaryPhase = {
        key,
        label: status.label,
        color: status.color || STATUS_COLORS[fallbackColorIndex % STATUS_COLORS.length],
      };
      fallbackColorIndex += 1;

      if (status.id === project.completedStatusId) {
        // If this label is completed in any case, keep it at the far right of
        // the summary so the visual order stays intuitive.
        activePhases.delete(key);
        if (!completedPhases.has(key)) {
          completedPhases.set(key, phase);
        }
        return;
      }

      if (!activePhases.has(key) && !completedPhases.has(key)) {
        activePhases.set(key, phase);
      }
    });
  });

  return [...activePhases.values(), ...completedPhases.values()];
}

function summaryPhaseCountsForProject(project: Project, phases: SummaryPhase[]) {
  const counts = phases.reduce<Record<string, number>>((current, phase) => {
    current[phase.key] = 0;
    return current;
  }, {});

  project.actions.forEach((action) => {
    const status = statusFor(project, action.statusId);
    const key = phaseKey(status.label);
    counts[key] = (counts[key] || 0) + 1;
  });

  return counts;
}

function reminderMinutesFor(action?: Action) {
  if (!action || !action.reminder) {
    return undefined;
  }
  if (typeof action.reminderMinutes === 'number') {
    return action.reminderMinutes;
  }
  return action.reminder ? 60 : undefined;
}

function calendarChoiceLabel(choice: CalendarChoice) {
  return choice.account ? choice.title + ' · ' + choice.account : choice.title;
}

function calendarEventDetails(project: Project, action: Action) {
  const start = fromDateKey(action.dueDate, action.dueTime);
  if (!action.dueTime) {
    start.setHours(0, 0, 0, 0);
  }
  const finish = new Date(start.getTime() + (action.dueTime ? 60 : 24 * 60) * 60 * 1000);
  const notes = [
    'Caso: ' + project.title,
    action.observations ? 'Observaciones: ' + action.observations : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  return {
    title: project.title + ': ' + action.title,
    notes,
    startDate: start,
    endDate: finish,
    allDay: !action.dueTime,
  };
}

function selectedInvitees(action: Action, contacts: Contact[]) {
  const wanted = new Set(action.inviteeIds || []);
  return contacts.filter((contact) => wanted.has(contact.id));
}

async function syncDeviceCalendarInvitees(
  event: Calendar.ExpoCalendarEvent,
  action: Action,
  contacts: Contact[],
) {
  const invitees = selectedInvitees(action, contacts);
  if (Platform.OS !== 'android') {
    // iOS does not expose a reliable programmatic attendee API through the
    // device calendar. The event and its local reminder still work normally.
    action.calendarInviteeEmails = invitees.map((contact) => contact.email);
    return;
  }
  const desiredEmails = invitees.map((contact) => contact.email.toLowerCase());
  const previouslySynced = new Set(
    (action.calendarInviteeEmails || []).map((email) => email.toLowerCase()),
  );

  const existingAttendees = await event.getAttendees();
  for (const attendee of existingAttendees) {
    const email = attendee.email?.toLowerCase();
    if (email && previouslySynced.has(email) && !desiredEmails.includes(email)) {
      await attendee.delete();
    }
  }

  const existingEmails = new Set(
    (await event.getAttendees())
      .map((attendee) => attendee.email?.toLowerCase())
      .filter((email): email is string => Boolean(email)),
  );
  for (const contact of invitees) {
    if (!existingEmails.has(contact.email.toLowerCase())) {
      await event.createAttendee({
        name: contact.name,
        email: contact.email,
        role: Calendar.AttendeeRole.ATTENDEE,
        status: Calendar.AttendeeStatus.INVITED,
        type: Calendar.AttendeeType.REQUIRED,
      });
    }
  }

  action.calendarInviteeEmails = invitees.map((contact) => contact.email);
}

async function cancelReminder(notificationId?: string) {
  if (!notificationId || Platform.OS === 'web') {
    return;
  }
  try {
    await cancelScheduledNotificationAsync(notificationId);
  } catch {
    // The reminder may already have fired or been removed by the device.
  }
}

async function scheduleReminder(action: Action, projectTitle: string) {
  const reminderMinutes = reminderMinutesFor(action);
  if (reminderMinutes === undefined || !action.dueDate || Platform.OS === 'web') {
    return undefined;
  }

  const reminderAt = new Date(
    fromDateKey(action.dueDate, action.dueTime).getTime() - reminderMinutes * 60 * 1000,
  );
  if (reminderAt.getTime() <= Date.now()) {
    return undefined;
  }

  try {
    const existingPermissions = await getPermissionsAsync();
    const permissions =
      existingPermissions.status === 'granted'
        ? existingPermissions
        : await requestPermissionsAsync();

    if (permissions.status !== 'granted') {
      Alert.alert(
        'Recordatorios desactivados',
        'Puedes permitir las notificaciones desde los ajustes de tu teléfono cuando quieras.',
      );
      return undefined;
    }

    return await scheduleNotificationAsync({
      content: {
        title: action.title,
        body: projectTitle,
      },
      trigger: {
        type: SchedulableTriggerInputTypes.DATE,
        date: reminderAt,
      },
    });
  } catch {
    Alert.alert(
      'No se programó el recordatorio',
      'Revisa que las notificaciones estén permitidas para Organiza.',
    );
    return undefined;
  }
}

async function removeDeviceCalendarEvent(calendarEventId?: string) {
  if (!calendarEventId || Platform.OS === 'web') {
    return;
  }
  try {
    const event = await Calendar.ExpoCalendarEvent.get(calendarEventId);
    await event.delete();
  } catch {
    // The event may already have been removed directly from the calendar.
  }
}

async function syncDeviceCalendarEvent(project: Project, action: Action, contacts: Contact[]) {
  if (
    Platform.OS === 'web' ||
    !project.useGoogleCalendar ||
    !project.calendarId ||
    !action.dueDate
  ) {
    return {
      id: action.calendarEventId,
      calendarId: action.calendarEventCalendarId,
    };
  }

  const details = calendarEventDetails(project, action);
  try {
    if (action.calendarEventId) {
      try {
        const existing = await Calendar.ExpoCalendarEvent.get(action.calendarEventId);
        await existing.update(details);
        await syncDeviceCalendarInvitees(existing, action, contacts);
        return {
          id: action.calendarEventId,
          calendarId: action.calendarEventCalendarId || project.calendarId,
        };
      } catch {
        // If the event was removed manually, create it again in the selected calendar.
      }
    }

    const calendar = await Calendar.ExpoCalendar.get(project.calendarId);
    const event = await calendar.createEvent(details);
    await syncDeviceCalendarInvitees(event, action, contacts);
    return {
      id: event.id,
      calendarId: project.calendarId,
    };
  } catch {
    Alert.alert(
      'No se pudo agendar',
      'Comprueba que el calendario elegido siga disponible y permita agregar eventos.',
    );
    return {
      // Keep the current reference intact when an update fails. Otherwise an
      // event could become orphaned and could not be cancelled later.
      id: action.calendarEventId,
      calendarId: action.calendarEventCalendarId,
    };
  }
}

async function syncCalendarEvent(project: Project, action: Action, contacts: Contact[]) {
  return syncDeviceCalendarEvent(project, action, contacts);
}

async function removeManagedCalendarEvent(action: Action) {
  await removeDeviceCalendarEvent(action.calendarEventId);
}

function OrganizaApp() {
  const { width, height } = useWindowDimensions();
  const mobileLayout = useMemo<MobileLayout>(
    () => ({
      compact: width < 380 || height < 700,
      edge: Math.max(14, Math.min(20, Math.round(width * 0.052))),
      tableMaxHeight: Math.max(285, Math.min(525, Math.round(height * 0.56))),
      width,
    }),
    [height, width],
  );
  const [data, setData] = useState<AppData>(initialData);
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [modal, setModal] = useState<ActiveModal>(null);
  const [quickDate, setQuickDate] = useState<QuickDate | null>(null);

  const [projectTitle, setProjectTitle] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [projectStatusText, setProjectStatusText] = useState(
    'Pendiente, En proceso, Realizada',
  );
  const [completedStatusLabel, setCompletedStatusLabel] = useState('Realizada');
  const [projectCalendarEnabled, setProjectCalendarEnabled] = useState(false);
  const [projectCalendarChoice, setProjectCalendarChoice] = useState<CalendarChoice | null>(null);
  const [calendarChoices, setCalendarChoices] = useState<CalendarChoice[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);

  const [actionTitle, setActionTitle] = useState('');
  const [actionDate, setActionDate] = useState<Date | undefined>();
  const [actionTime, setActionTime] = useState<Date | undefined>();
  const [showActionDatePicker, setShowActionDatePicker] = useState(false);
  const [showActionTimePicker, setShowActionTimePicker] = useState(false);
  const [actionObservations, setActionObservations] = useState('');
  const [actionStatusId, setActionStatusId] = useState('');
  const [actionRemindersEnabled, setActionRemindersEnabled] = useState(false);
  const [actionReminderMinutes, setActionReminderMinutes] = useState<number>(60);
  const [actionInviteeIds, setActionInviteeIds] = useState<string[]>([]);

  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (saved) {
          setData(normalizeData(JSON.parse(saved) as Partial<AppData>));
        }
      } catch {
        Alert.alert('No fue posible recuperar tus casos guardados');
      } finally {
        setReady(true);
      }
    }

    void load();
  }, []);

  useEffect(() => {
    if (ready) {
      void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }
  }, [data, ready]);

  useEffect(() => {
    if (Platform.OS === 'web') {
      return;
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (quickDate) {
        setQuickDate(null);
        return true;
      }
      if (modal) {
        setModal(null);
        return true;
      }
      if (screen.name !== 'home') {
        setScreen({ name: 'home' });
        return true;
      }
      // On the home screen Android keeps its normal behavior: it closes the app.
      return false;
    });

    return () => subscription.remove();
  }, [modal, quickDate, screen.name]);

  const activeProject =
    screen.name === 'project'
      ? data.projects.find((project) => project.id === screen.projectId)
      : undefined;

  const homeProjectData = useMemo(
    () =>
      data.projects.map((project) => ({
        project,
        counts: countByStatus(project),
        state: generalProjectState(project),
      })),
    [data.projects],
  );

  function findAction(projectId: string, actionId: string) {
    const project = data.projects.find((item) => item.id === projectId);
    const action = project?.actions.find((item) => item.id === actionId);
    return { project, action };
  }

  function openProjectSheet() {
    setProjectTitle('');
    setProjectDescription('');
    setProjectStatusText('Pendiente, En proceso, Realizada');
    setCompletedStatusLabel('Realizada');
    setProjectCalendarEnabled(false);
    setProjectCalendarChoice(null);
    setCalendarChoices([]);
    setCalendarLoading(false);
    setModal({ type: 'project' });
  }

  function openProjectSettings(projectId: string) {
    const project = data.projects.find((item) => item.id === projectId);
    if (!project) {
      return;
    }

    const statuses = orderedStatuses(project);
    setProjectTitle(project.title);
    setProjectDescription(project.description || '');
    setProjectStatusText(statuses.map((status) => status.label).join(', '));
    setCompletedStatusLabel(
      statuses.find((status) => status.id === project.completedStatusId)?.label ||
        statuses[statuses.length - 1]?.label ||
        '',
    );
    setModal({ type: 'project-settings', projectId });
  }

  function updateProjectStatusText(value: string) {
    const formatted = capitalizePhaseList(value);
    const labels = formatted
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    setProjectStatusText(formatted);
    if (labels.length && !labels.includes(completedStatusLabel)) {
      setCompletedStatusLabel(labels[labels.length - 1]);
    }
  }

  function openContactSheet(contactId?: string) {
    const contact = contactId ? data.contacts.find((item) => item.id === contactId) : undefined;
    setContactName(contact?.name || '');
    setContactEmail(contact?.email || '');
    setModal({ type: 'contact', contactId });
  }

  function saveContact(contactId?: string) {
    const name = capitalizeFirst(contactName.trim());
    const email = contactEmail.trim().toLowerCase();
    if (!name || !email) {
      Alert.alert('Completa el nombre y el correo del contacto');
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      Alert.alert('Escribe un correo válido');
      return;
    }
    const isDuplicate = data.contacts.some(
      (contact) => contact.id !== contactId && contact.email.toLowerCase() === email,
    );
    if (isDuplicate) {
      Alert.alert('Ese correo ya está guardado en tus contactos');
      return;
    }

    const now = new Date().toISOString();
    setData((current) => ({
      ...current,
      contacts: contactId
        ? current.contacts.map((contact) =>
            contact.id === contactId ? { ...contact, name, email, updatedAt: now } : contact,
          )
        : [...current.contacts, { id: uid('contact'), name, email, updatedAt: now }],
    }));
    setModal(null);
  }

  function deleteContact(contactId: string) {
    const contact = data.contacts.find((item) => item.id === contactId);
    if (!contact) {
      return;
    }
    Alert.alert(
      '¿Eliminar a ' + contact.name + '?',
      'Ya no aparecerá para nuevas invitaciones. Las invitaciones que ya existen en Calendar no se cancelarán.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: () => {
            setData((current) => ({
              contacts: current.contacts.filter((item) => item.id !== contactId),
              projects: current.projects.map((project) => ({
                ...project,
                actions: project.actions.map((action) => ({
                  ...action,
                  inviteeIds: (action.inviteeIds || []).filter((id) => id !== contactId),
                })),
              })),
            }));
            setModal(null);
          },
        },
      ],
    );
  }

  function toggleActionInvitee(contactId: string) {
    setActionInviteeIds((current) =>
      current.includes(contactId)
        ? current.filter((item) => item !== contactId)
        : [...current, contactId],
    );
  }

  async function requestGoogleCalendars() {
    if (Platform.OS === 'web') {
      Alert.alert(
        'Disponible en la app de prueba',
        'Para conectar Calendar, abre Organiza desde la app de prueba instalada en tu teléfono.',
      );
      return [] as CalendarChoice[];
    }

    try {
      const permission = await Calendar.requestCalendarPermissions(false);
      if (permission.status !== 'granted') {
        Alert.alert(
          'Permiso de Calendar necesario',
          'Permite el acceso a los calendarios para agendar acciones e invitar contactos.',
        );
        return [] as CalendarChoice[];
      }

      return (await Calendar.getCalendars(Calendar.EntityTypes.EVENT))
        .filter((calendar) => {
          const source = [
            calendar.source?.type,
            calendar.source?.name,
            calendar.ownerAccount,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          return (
            calendar.allowsModifications &&
            (source.includes('google') || source.includes('gmail.com'))
          );
        })
        .map((calendar) => ({
          id: calendar.id,
          title: calendar.title,
          account: calendar.ownerAccount || calendar.source?.name,
          isPrimary: calendar.isPrimary,
        }))
        .sort((first, second) => Number(Boolean(second.isPrimary)) - Number(Boolean(first.isPrimary)));
    } catch {
      Alert.alert(
        'No se pudo conectar Calendar',
        'Abre la app de prueba instalada y verifica el permiso de Calendar en tu teléfono.',
      );
      return [] as CalendarChoice[];
    }
  }

  async function loadGoogleCalendarChoices() {
    setCalendarLoading(true);
    const choices = await requestGoogleCalendars();
    setCalendarChoices(choices);
    setCalendarLoading(false);
    return choices;
  }

  async function addGoogleAccountToPhone() {
    if (Platform.OS === 'web') {
      Alert.alert(
        'Disponible en el teléfono',
        'Agrega la cuenta Google desde los ajustes de tu celular y después vuelve a Organiza para actualizar los calendarios.',
      );
      return;
    }

    if (Platform.OS === 'android') {
      try {
        await Linking.sendIntent('android.settings.ADD_ACCOUNT_SETTINGS');
        return;
      } catch {
        // Some Android brands do not expose this settings shortcut. The
        // instructions below still let the person add the account safely.
      }
    }

    Alert.alert(
      'Agrega la cuenta al teléfono',
      Platform.OS === 'ios'
        ? 'Ve a Ajustes, busca Calendar y entra a Cuentas de Calendar > Añadir cuenta. Inicia sesión con Google, activa Calendar y vuelve aquí para actualizar la lista.'
        : 'Ve a Ajustes y busca “Agregar cuenta” o “Cuentas y sincronización”. Elige Google, inicia sesión, activa Calendar y vuelve aquí para actualizar la lista.',
    );
  }

  async function refreshNewProjectCalendarChoices() {
    const choices = await loadGoogleCalendarChoices();
    setProjectCalendarChoice((current) =>
      choices.find(
        (choice) => choice.id === current?.id && choice.account === current?.account,
      ) || choices[0] || null,
    );
  }

  async function chooseCalendarForNewProject(enabled: boolean) {
    if (!enabled) {
      setProjectCalendarEnabled(false);
      setProjectCalendarChoice(null);
      setCalendarChoices([]);
      return;
    }

    setProjectCalendarEnabled(true);
    const choices = await loadGoogleCalendarChoices();
    setProjectCalendarChoice(choices[0] || null);
  }

  function createProject() {
    const title = capitalizeFirst(projectTitle.trim());
    const labels = projectStatusText
      .split(',')
      .map((item) => capitalizeFirst(item.trim()))
      .filter(Boolean);

    if (!title) {
      Alert.alert('Escribe el nombre del caso');
      return;
    }
    if (labels.length < 2) {
      Alert.alert('Agrega al menos dos fases separadas por comas');
      return;
    }
    if (projectCalendarEnabled && !projectCalendarChoice) {
      Alert.alert('Elige un calendario antes de crear el caso');
      return;
    }

    const rawStatuses = labels.map((label, index) => ({
      id: uid('status'),
      label,
      color: STATUS_COLORS[index % STATUS_COLORS.length],
    }));
    const completed =
      rawStatuses.find((status) => status.label === completedStatusLabel) ||
      rawStatuses[rawStatuses.length - 1];
    const statuses = [
      ...rawStatuses.filter((status) => status.id !== completed.id),
      completed,
    ];
    const project: Project = {
      id: uid('project'),
      title,
      description: capitalizeFirst(projectDescription.trim()) || undefined,
      statuses,
      completedStatusId: completed.id,
      useGoogleCalendar: projectCalendarEnabled,
      calendarId: projectCalendarChoice?.id,
      calendarTitle: projectCalendarChoice?.title,
      calendarAccount: projectCalendarChoice?.account,
      actions: [],
    };

    setData((current) => ({ ...current, projects: [...current.projects, project] }));
    setModal(null);
    setScreen({ name: 'project', projectId: project.id });
  }

  function saveProjectSettings(projectId: string) {
    const project = data.projects.find((item) => item.id === projectId);
    if (!project) {
      return;
    }

    const title = capitalizeFirst(projectTitle.trim());
    const description = capitalizeFirst(projectDescription.trim()) || undefined;
    const labels = projectStatusText
      .split(',')
      .map((item) => capitalizeFirst(item.trim()))
      .filter(Boolean);
    const keys = labels.map(phaseKey);

    if (!title) {
      Alert.alert('Escribe el nombre del caso');
      return;
    }
    if (labels.length < 2) {
      Alert.alert('Agrega al menos dos fases separadas por comas');
      return;
    }
    if (new Set(keys).size !== keys.length) {
      Alert.alert('Cada fase debe tener un nombre distinto');
      return;
    }

    const currentStatuses = orderedStatuses(project);
    const newKeys = new Set(keys);
    const unmatchedOldStatuses = currentStatuses.filter(
      (status) => !newKeys.has(phaseKey(status.label)),
    );
    const statusesBeforeOrdering = labels.map((label, index) => {
      const matchingStatus = currentStatuses.find(
        (status) => phaseKey(status.label) === phaseKey(label),
      );
      const reusableStatus = matchingStatus || unmatchedOldStatuses.shift();
      return reusableStatus
        ? { ...reusableStatus, label, color: reusableStatus.color || STATUS_COLORS[index % STATUS_COLORS.length] }
        : { id: uid('status'), label, color: STATUS_COLORS[index % STATUS_COLORS.length] };
    });
    const completed =
      statusesBeforeOrdering.find((status) => status.label === completedStatusLabel) ||
      statusesBeforeOrdering[statusesBeforeOrdering.length - 1];
    const statuses = [
      ...statusesBeforeOrdering.filter((status) => status.id !== completed.id),
      completed,
    ];
    const statusIds = new Set(statuses.map((status) => status.id));
    const fallbackStatus = statuses.find((status) => status.id !== completed.id) || statuses[0];
    const now = new Date().toISOString();

    setData((current) => ({
      ...current,
      projects: current.projects.map((item) =>
        item.id !== projectId
          ? item
          : {
              ...item,
              title,
              description,
              statuses,
              completedStatusId: completed.id,
              actions: item.actions.map((action) =>
                statusIds.has(action.statusId)
                  ? action
                  : { ...action, statusId: fallbackStatus.id, updatedAt: now },
              ),
            },
      ),
    }));
    setModal(null);
  }

  function openActionSheet(projectId: string, actionId?: string) {
    const { project, action } = actionId ? findAction(projectId, actionId) : { project: data.projects.find((item) => item.id === projectId), action: undefined };
    if (!project) {
      return;
    }

    setActionTitle(action?.title || '');
    setActionDate(action?.dueDate ? fromDateKey(action.dueDate, action.dueTime) : undefined);
    setActionTime(action?.dueTime ? fromDateKey(action.dueDate, action.dueTime) : undefined);
    setActionObservations(action?.observations || '');
    setActionStatusId(action?.statusId || orderedStatuses(project)[0].id);
    setActionRemindersEnabled(reminderMinutesFor(action) !== undefined);
    setActionReminderMinutes(reminderMinutesFor(action) ?? 60);
    setActionInviteeIds(action?.inviteeIds || []);
    setShowActionDatePicker(false);
    setShowActionTimePicker(false);
    setModal({ type: 'action', projectId, actionId });
  }

  async function saveAction(projectId: string, actionId?: string) {
    const { project, action: previousAction } = actionId
      ? findAction(projectId, actionId)
      : { project: data.projects.find((item) => item.id === projectId), action: undefined };
    if (!project) {
      return;
    }

    if (!actionTitle.trim()) {
      Alert.alert('Escribe la tarea o acción');
      return;
    }
    if (actionRemindersEnabled && !actionDate) {
      Alert.alert('Agrega una fecha antes de activar el recordatorio');
      return;
    }
    if (actionInviteeIds.length && !actionDate) {
      Alert.alert('Agrega una fecha antes de invitar contactos');
      return;
    }
    if (actionInviteeIds.length && !actionTime) {
      Alert.alert('Agrega una hora para enviar invitaciones de Calendar');
      return;
    }

    await cancelReminder(previousAction?.notificationId);
    const action: Action = {
      id: actionId || uid('action'),
      title: capitalizeFirst(actionTitle.trim()),
      dueDate: actionDate ? toDateKey(actionDate) : undefined,
      dueTime: actionTime ? toTimeKey(actionTime) : undefined,
      observations: actionObservations.trim()
        ? capitalizeFirst(actionObservations.trim())
        : undefined,
      statusId: actionStatusId,
      reminder: actionRemindersEnabled,
      reminderMinutes: actionRemindersEnabled ? actionReminderMinutes : undefined,
      inviteeIds: actionInviteeIds,
      calendarEventId: previousAction?.calendarEventId,
      calendarEventCalendarId: previousAction?.calendarEventCalendarId,
      calendarInviteeEmails: previousAction?.calendarInviteeEmails,
      updatedAt: new Date().toISOString(),
    };
    action.notificationId = await scheduleReminder(action, project.title);
    if (!action.dueDate && previousAction?.calendarEventId) {
      try {
        await removeManagedCalendarEvent(previousAction);
      } catch (error) {
        Alert.alert(
          'No se quitó el evento de Calendar',
          error instanceof Error
            ? error.message
            : 'Comprueba que el calendario siga disponible antes de quitar la fecha.',
        );
        return;
      }
      action.calendarEventId = undefined;
      action.calendarEventCalendarId = undefined;
      action.calendarInviteeEmails = [];
    } else {
      const synced = await syncCalendarEvent(project, action, data.contacts);
      action.calendarEventId = synced.id;
      action.calendarEventCalendarId = synced.calendarId;
    }

    setData((current) => ({
      ...current,
      projects: current.projects.map((item) =>
        item.id !== projectId
          ? item
          : {
              ...item,
              actions: actionId
                ? item.actions.map((existing) => (existing.id === actionId ? action : existing))
                : [...item.actions, action],
            },
      ),
    }));
    setModal(null);
  }

  async function applyQuickDate(projectId: string, actionId: string, date: Date) {
    const { project, action: existing } = findAction(projectId, actionId);
    if (!project || !existing) {
      return;
    }

    await cancelReminder(existing.notificationId);
    const updated: Action = {
      ...existing,
      dueDate: toDateKey(date),
      updatedAt: new Date().toISOString(),
    };
    updated.notificationId = await scheduleReminder(updated, project.title);
    const synced = await syncCalendarEvent(project, updated, data.contacts);
    updated.calendarEventId = synced.id;
    updated.calendarEventCalendarId = synced.calendarId;

    setData((current) => ({
      ...current,
      projects: current.projects.map((item) =>
        item.id !== projectId
          ? item
          : {
              ...item,
              actions: item.actions.map((action) =>
                action.id === actionId ? updated : action,
              ),
            },
      ),
    }));
  }

  function setActionStatus(projectId: string, actionId: string, statusId: string) {
    setData((current) => ({
      ...current,
      projects: current.projects.map((project) =>
        project.id !== projectId
          ? project
          : {
              ...project,
              actions: project.actions.map((action) =>
                action.id === actionId
                  ? { ...action, statusId, updatedAt: new Date().toISOString() }
                  : action,
              ),
            },
      ),
    }));
    setModal(null);
  }

  async function finishDeletingAction(
    projectId: string,
    actionId: string,
    removeCalendar: boolean,
  ) {
    const { action } = findAction(projectId, actionId);
    if (!action) {
      return;
    }
    try {
      await cancelReminder(action.notificationId);
      if (removeCalendar) {
        await removeManagedCalendarEvent(action);
      }
    } catch (error) {
      Alert.alert(
        'No se eliminó la acción',
        error instanceof Error
          ? error.message
          : 'No se pudo quitar su evento del calendario. Inténtalo otra vez.',
      );
      return;
    }
    setData((current) => ({
      ...current,
      projects: current.projects.map((project) =>
        project.id !== projectId
          ? project
          : {
              ...project,
              actions: project.actions.filter((item) => item.id !== actionId),
            },
      ),
    }));
    setModal(null);
  }

  function deleteAction(projectId: string, actionId: string) {
    const { action } = findAction(projectId, actionId);
    if (!action) {
      return;
    }
    if (!action.calendarEventId) {
      Alert.alert('¿Eliminar esta acción?', 'No se puede deshacer.', [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: () => void finishDeletingAction(projectId, actionId, false),
        },
      ]);
      return;
    }
    Alert.alert(
      '¿Eliminar acción y evento?',
      'También se quitará el evento del calendario que elegiste.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Solo eliminar acción',
          style: 'destructive',
          onPress: () => void finishDeletingAction(projectId, actionId, false),
        },
        {
          text: 'Eliminar y cancelar evento',
          style: 'destructive',
          onPress: () => void finishDeletingAction(projectId, actionId, true),
        },
      ],
    );
  }

  async function finishDeletingProject(projectId: string, removeCalendar: boolean) {
    const project = data.projects.find((item) => item.id === projectId);
    if (!project) {
      return;
    }
    try {
      for (const action of project.actions) {
        await cancelReminder(action.notificationId);
        if (removeCalendar) {
          await removeManagedCalendarEvent(action);
        }
      }
    } catch (error) {
      Alert.alert(
        'No se eliminó el caso',
        (error instanceof Error ? error.message : 'No se pudo cancelar un evento de Calendar.') +
          ' El caso se conserva para que puedas volver a intentarlo sin perder el control.',
      );
      return;
    }
    setData((current) => ({
      ...current,
      projects: current.projects.filter((item) => item.id !== projectId),
    }));
    setModal(null);
    setScreen({ name: 'home' });
  }

  function deleteProject(projectId: string) {
    const project = data.projects.find((item) => item.id === projectId);
    if (!project) {
      return;
    }
    const eventCount = project.actions.filter((action) => action.calendarEventId).length;
    const actionLabel = project.actions.length === 1 ? '1 acción' : project.actions.length + ' acciones';
    if (!eventCount) {
      Alert.alert(
        '¿Eliminar este caso?',
        'Se eliminará ' + actionLabel + ' y no se puede deshacer.',
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Eliminar caso',
            style: 'destructive',
            onPress: () => void finishDeletingProject(projectId, false),
          },
        ],
      );
      return;
    }
    Alert.alert(
      '¿Eliminar este caso?',
      'Se eliminarán ' +
        actionLabel +
        ' y ' +
        eventCount +
        (eventCount === 1 ? ' evento de Calendar.' : ' eventos de Calendar.') +
        ' También puedes quitarlos del calendario.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Solo eliminar caso',
          style: 'destructive',
          onPress: () => void finishDeletingProject(projectId, false),
        },
        {
          text: 'Eliminar y cancelar eventos',
          style: 'destructive',
          onPress: () => void finishDeletingProject(projectId, true),
        },
      ],
    );
  }

  async function openCalendarChooser(projectId: string, mode: 'connect' | 'change') {
    await loadGoogleCalendarChoices();
    setModal({ type: 'calendar', projectId, mode });
  }

  async function connectCalendarToProject(
    projectId: string,
    choice: CalendarChoice,
    mode: 'connect' | 'change',
  ) {
    const project = data.projects.find((item) => item.id === projectId);
    if (!project) {
      return;
    }

    if (mode === 'change') {
      const oldCalendarId = project.calendarId;
      setData((current) => ({
        ...current,
        projects: current.projects.map((item) =>
          item.id !== projectId
            ? item
            : {
                ...item,
                useGoogleCalendar: true,
                calendarId: choice.id,
                calendarTitle: choice.title,
                calendarAccount: choice.account,
                // Existing events stay in their current account. New actions use the one chosen now.
                actions: item.actions.map((action) =>
                  action.calendarEventId && !action.calendarEventCalendarId
                    ? {
                        ...action,
                        calendarEventCalendarId: oldCalendarId,
                      }
                    : action,
                ),
              },
        ),
      }));
      setModal(null);
      return;
    }

    const connectedProject: Project = {
      ...project,
      useGoogleCalendar: true,
      calendarId: choice.id,
      calendarTitle: choice.title,
      calendarAccount: choice.account,
    };
    const syncedActions = new Map<string, Action>();
    for (const existing of project.actions) {
      if (existing.dueDate && !existing.calendarEventId) {
        const action: Action = {
          ...existing,
        };
        const synced = await syncCalendarEvent(connectedProject, action, data.contacts);
        action.calendarEventId = synced.id;
        action.calendarEventCalendarId = synced.calendarId;
        syncedActions.set(action.id, action);
      }
    }

    setData((current) => ({
      ...current,
      projects: current.projects.map((item) =>
        item.id !== projectId
          ? item
          : {
              ...item,
              useGoogleCalendar: true,
              calendarId: choice.id,
              calendarTitle: choice.title,
              calendarAccount: choice.account,
              actions: item.actions.map((existing) =>
                syncedActions.has(existing.id)
                  ? syncedActions.get(existing.id)!
                  : existing,
              ),
            },
      ),
    }));
    setModal(null);
  }

  async function syncActionWithCalendar(project: Project, action: Action) {
    if (!action.dueDate) {
      Alert.alert('Primero elige una fecha de entrega');
      return;
    }
    if (!project.useGoogleCalendar || !project.calendarId) {
      await openCalendarChooser(project.id, 'connect');
      return;
    }

    const updated = { ...action };
    const synced = await syncCalendarEvent(project, updated, data.contacts);
    updated.calendarEventId = synced.id;
    updated.calendarEventCalendarId = synced.calendarId;
    setData((current) => ({
      ...current,
      projects: current.projects.map((item) =>
        item.id !== project.id
          ? item
          : {
              ...item,
              actions: item.actions.map((existing) =>
                existing.id === action.id ? updated : existing,
              ),
            },
      ),
    }));
  }

  function renderMainScreen() {
    if (screen.name === 'contacts') {
      return (
        <ContactsScreen
          contacts={data.contacts}
          layout={mobileLayout}
          onBack={() => setScreen({ name: 'home' })}
          onNewContact={() => openContactSheet()}
          onEditContact={(contactId) => openContactSheet(contactId)}
        />
      );
    }

    if (screen.name === 'summary') {
      return (
        <SummaryScreen
          projects={homeProjectData}
          layout={mobileLayout}
          onBack={() => setScreen({ name: 'home' })}
          onOpenProject={(projectId) => setScreen({ name: 'project', projectId })}
        />
      );
    }

    if (screen.name === 'project' && activeProject) {
      return (
        <ProjectScreen
          project={activeProject}
          contacts={data.contacts}
          layout={mobileLayout}
          onBack={() => setScreen({ name: 'home' })}
          onNewAction={() => openActionSheet(activeProject.id)}
          onEditAction={(actionId) => openActionSheet(activeProject.id, actionId)}
          onPickDate={(actionId, date) =>
            setQuickDate({ projectId: activeProject.id, actionId, value: date })
          }
          onChangeStatus={(actionId) =>
            setModal({ type: 'status', projectId: activeProject.id, actionId })
          }
          onSyncCalendar={(action) => void syncActionWithCalendar(activeProject, action)}
          onChooseCalendar={() =>
            void openCalendarChooser(
              activeProject.id,
              activeProject.useGoogleCalendar ? 'change' : 'connect',
            )
          }
          onOpenSettings={() => openProjectSettings(activeProject.id)}
        />
      );
    }

    return (
      <HomeScreen
        projects={homeProjectData}
        layout={mobileLayout}
        onNewProject={openProjectSheet}
        onOpenProject={(projectId) => setScreen({ name: 'project', projectId })}
        onOpenContacts={() => setScreen({ name: 'contacts' })}
        onOpenSummary={() => setScreen({ name: 'summary' })}
      />
    );
  }

  function renderModal() {
    if (!modal) {
      return null;
    }

    if (modal.type === 'project') {
      const labels = projectStatusText
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      const orderedLabels = orderLabelsWithCompletedLast(labels, completedStatusLabel);
      return (
        <BottomSheet title="Nuevo caso" onClose={() => setModal(null)}>
          <Field
            label="Nombre del caso"
            placeholder="Ej. Juicio de arrendamiento"
            value={projectTitle}
            onChangeText={(value) => setProjectTitle(capitalizeFirst(value))}
          />
          <Field
            label="Descripción breve (opcional)"
            helper="Una nota corta para reconocer el caso sin abrirlo."
            placeholder="Ej. Preparar demanda y dar seguimiento a audiencias"
            value={projectDescription}
            onChangeText={(value) => setProjectDescription(capitalizeFirst(value))}
            multiline
          />
          <Field
            label="Fases del caso"
            helper="Escríbelas separadas por comas."
            placeholder="Pendiente, En proceso, Realizada"
            value={projectStatusText}
            onChangeText={updateProjectStatusText}
          />
          <Text style={styles.fieldLabel}>Elige la fase que marca una tarea como completada</Text>
          <View style={styles.choiceWrap}>
            {orderedLabels.map((label) => (
              <ChoiceChip
                key={label}
                label={label}
                selected={completedStatusLabel === label}
                onPress={() => setCompletedStatusLabel(label)}
              />
            ))}
          </View>
          <View style={styles.switchRow}>
            <View style={styles.switchCopy}>
              <Text style={styles.switchTitle}>Conectar calendario</Text>
              <Text style={styles.switchHint}>
                Las acciones con fecha se agregarán automáticamente al calendario que elijas.
              </Text>
            </View>
            <Switch
              value={projectCalendarEnabled}
              onValueChange={(enabled) => void chooseCalendarForNewProject(enabled)}
              trackColor={{ false: '#D8D5E8', true: '#8DBFAF' }}
            />
          </View>
          {projectCalendarEnabled ? (
            <View style={styles.calendarSetup}>
              <Text style={styles.fieldLabel}>Calendario para este caso</Text>
              <Text style={styles.fieldHelper}>
                {calendarLoading
                  ? 'Buscando los calendarios del teléfono…'
                  : 'Toca el calendario donde quieres que se agenden las acciones.'}
              </Text>
              {!calendarLoading && calendarChoices.length ? (
                <View style={styles.choiceWrap}>
                  {calendarChoices.map((choice) => (
                    <ChoiceChip
                      key={choice.id + ':' + choice.account}
                      label={calendarChoiceLabel(choice)}
                      selected={
                        projectCalendarChoice?.id === choice.id &&
                        projectCalendarChoice?.account === choice.account
                      }
                      onPress={() => setProjectCalendarChoice(choice)}
                    />
                  ))}
                </View>
              ) : null}
              {!calendarLoading && !calendarChoices.length ? (
                <View style={styles.calendarEmptyState}>
                  <Text style={styles.calendarEmptyTitle}>No encontramos calendarios Google</Text>
                  <Text style={styles.calendarEmptyText}>
                    Verifica que tu cuenta Google ya esté agregada al teléfono y luego actualiza la lista.
                  </Text>
                </View>
              ) : null}
              <CalendarAccountTools
                loading={calendarLoading}
                onAddAccount={() => void addGoogleAccountToPhone()}
                onRefresh={() => void refreshNewProjectCalendarChoices()}
              />
            </View>
          ) : null}
          <PrimaryButton label="Crear caso" onPress={createProject} />
        </BottomSheet>
      );
    }

    if (modal.type === 'project-settings') {
      const project = data.projects.find((item) => item.id === modal.projectId);
      if (!project) {
        return null;
      }
      const labels = projectStatusText
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      const orderedLabels = orderLabelsWithCompletedLast(labels, completedStatusLabel);
      const connectedCalendar = project.useGoogleCalendar && project.calendarTitle;
      return (
        <BottomSheet title="Configuración del caso" onClose={() => setModal(null)}>
          <Text style={styles.sheetDescription}>
            Ajusta la información y el flujo de trabajo de este caso. Tus acciones se conservan.
          </Text>
          <Field
            label="Nombre del caso"
            value={projectTitle}
            onChangeText={(value) => setProjectTitle(capitalizeFirst(value))}
          />
          <Field
            label="Descripción breve (opcional)"
            helper="Úsala como contexto visible debajo del título del caso."
            placeholder="Ej. Preparar demanda y dar seguimiento a audiencias"
            value={projectDescription}
            onChangeText={(value) => setProjectDescription(capitalizeFirst(value))}
            multiline
          />
          <Field
            label="Fases del caso"
            helper="Sepáralas con comas. Si eliminas una fase, sus acciones pasan a la primera fase."
            value={projectStatusText}
            onChangeText={updateProjectStatusText}
          />
          <Text style={styles.fieldLabel}>Elige la fase que marca una tarea como completada</Text>
          <View style={styles.choiceWrap}>
            {orderedLabels.map((label) => (
              <ChoiceChip
                key={label}
                label={label}
                selected={completedStatusLabel === label}
                onPress={() => setCompletedStatusLabel(label)}
              />
            ))}
          </View>
          <Text style={styles.settingsSectionLabel}>CALENDARIO</Text>
          <Pressable
            style={styles.settingsCalendarRow}
            onPress={() =>
              void openCalendarChooser(
                project.id,
                project.useGoogleCalendar ? 'change' : 'connect',
              )
            }
          >
            <View style={styles.settingsCalendarCopy}>
              <Text style={styles.settingsCalendarTitle}>Calendario</Text>
              <Text style={styles.settingsCalendarText} numberOfLines={1}>
                {connectedCalendar
                  ? project.calendarTitle +
                    (project.calendarAccount ? ' · ' + project.calendarAccount : '')
                  : 'Sin conectar'}
              </Text>
            </View>
            <Text style={styles.settingsCalendarAction}>
              {connectedCalendar ? 'Cambiar ›' : 'Conectar ›'}
            </Text>
          </Pressable>
          <PrimaryButton
            label="Guardar configuración"
            onPress={() => saveProjectSettings(project.id)}
          />
          <Pressable style={styles.deleteButton} onPress={() => deleteProject(project.id)}>
            <Text style={styles.deleteButtonText}>Eliminar caso</Text>
          </Pressable>
        </BottomSheet>
      );
    }

    if (modal.type === 'calendar') {
      return (
        <BottomSheet
          title={
            modal.mode === 'change'
              ? 'Cambiar calendario'
              : 'Conectar calendario'
          }
          onClose={() => setModal(null)}
        >
          <Text style={styles.sheetDescription}>
            {modal.mode === 'change'
              ? 'Los eventos ya creados se quedan en su calendario actual. Las acciones nuevas usarán la cuenta o calendario que elijas ahora.'
              : 'Las acciones con fecha se agregarán automáticamente al calendario elegido. Los recordatorios se programan directamente en este teléfono.'}
          </Text>
          {calendarLoading ? (
            <Text style={styles.calendarLoadingText}>Actualizando tus calendarios…</Text>
          ) : calendarChoices.length ? (
            <View style={styles.calendarList}>
              {calendarChoices.map((choice) => (
                <Pressable
                  key={choice.id + ':' + choice.account}
                  style={styles.calendarOption}
                  onPress={() => void connectCalendarToProject(modal.projectId, choice, modal.mode)}
                >
                  <View style={styles.calendarOptionCopy}>
                    <Text style={styles.calendarOptionTitle}>{choice.title}</Text>
                    {choice.account ? (
                      <Text style={styles.calendarOptionAccount}>{choice.account}</Text>
                    ) : null}
                  </View>
                  {choice.isPrimary ? <Text style={styles.calendarPrimary}>Principal</Text> : null}
                  <Text style={styles.calendarOptionArrow}>›</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <View style={styles.calendarEmptyState}>
              <Text style={styles.calendarEmptyTitle}>No encontramos calendarios Google</Text>
              <Text style={styles.calendarEmptyText}>
                Verifica que la cuenta Google esté agregada al teléfono y vuelve a actualizar la lista.
              </Text>
            </View>
          )}
          <CalendarAccountTools
            loading={calendarLoading}
            onAddAccount={() => void addGoogleAccountToPhone()}
            onRefresh={() => void loadGoogleCalendarChoices()}
          />
        </BottomSheet>
      );
    }

    if (modal.type === 'contact') {
      const contact = modal.contactId
        ? data.contacts.find((item) => item.id === modal.contactId)
        : undefined;
      return (
        <BottomSheet
          title={contact ? 'Editar contacto' : 'Nuevo contacto'}
          onClose={() => setModal(null)}
        >
          <Field
            label="Nombre"
            placeholder="Ej. Lic. Andrea López"
            value={contactName}
            onChangeText={(value) => setContactName(capitalizeFirst(value))}
            autoCapitalize="words"
          />
          <Field
            label="Correo electrónico"
            helper="En Android, Calendar puede usarlo al crear una invitación."
            placeholder="andrea@ejemplo.com"
            value={contactEmail}
            onChangeText={setContactEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <PrimaryButton
            label={contact ? 'Guardar cambios' : 'Agregar contacto'}
            onPress={() => saveContact(modal.contactId)}
          />
          {contact ? (
            <Pressable style={styles.deleteButton} onPress={() => deleteContact(contact.id)}>
              <Text style={styles.deleteButtonText}>Eliminar contacto</Text>
            </Pressable>
          ) : null}
        </BottomSheet>
      );
    }

    if (modal.type === 'action') {
      const project = data.projects.find((item) => item.id === modal.projectId);
      const action = modal.actionId
        ? project?.actions.find((item) => item.id === modal.actionId)
        : undefined;
      if (!project) {
        return null;
      }
      return (
        <BottomSheet
          title={action ? 'Editar acción' : 'Nueva acción'}
          onClose={() => setModal(null)}
        >
          <Field
            label="Tarea / acción"
            placeholder="Ej. Insumo"
            value={actionTitle}
            onChangeText={(value) => setActionTitle(capitalizeFirst(value))}
          />
          <Text style={styles.fieldLabel}>Fecha de entrega</Text>
          <Pressable
            style={styles.dateField}
            onPress={() => {
              setShowActionDatePicker(true);
              setShowActionTimePicker(false);
            }}
          >
            <Text style={actionDate ? styles.dateFieldText : styles.dateFieldPlaceholder}>
              ◷  {actionDate ? formatDate(toDateKey(actionDate)) : 'Elegir en calendario'}
            </Text>
            <Text style={styles.dateFieldArrow}>›</Text>
          </Pressable>
          {showActionDatePicker ? (
            <DateTimePicker
              value={actionDate || new Date()}
              mode="date"
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              onChange={(_, date) => {
                if (Platform.OS === 'android') {
                  setShowActionDatePicker(false);
                }
                if (date) {
                  setActionDate(date);
                }
              }}
            />
          ) : null}
          {actionDate ? (
            <>
              <Text style={[styles.fieldLabel, styles.timeLabel]}>Hora</Text>
              <Pressable
                style={styles.dateField}
                onPress={() => {
                  setShowActionTimePicker(true);
                  setShowActionDatePicker(false);
                }}
              >
                <Text style={actionTime ? styles.dateFieldText : styles.dateFieldPlaceholder}>
                  ◷  {actionTime ? formatTime(toTimeKey(actionTime)) : 'Opcional'}
                </Text>
                <Text style={styles.dateFieldArrow}>›</Text>
              </Pressable>
              {showActionTimePicker ? (
                <DateTimePicker
                  value={actionTime || actionDate}
                  mode="time"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(_, date) => {
                    if (Platform.OS === 'android') {
                      setShowActionTimePicker(false);
                    }
                    if (date) {
                      setActionTime(date);
                    }
                  }}
                />
              ) : null}
            </>
          ) : null}
          <Field
            label="Observaciones"
            placeholder="Añade detalles si los necesitas"
            value={actionObservations}
            onChangeText={(value) => setActionObservations(capitalizeFirst(value))}
            multiline
          />
          <Text style={styles.fieldLabel}>Invitados</Text>
          <Text style={styles.fieldHelper}>
            En Android, selecciónalos para incluirlos en la invitación del calendario.
          </Text>
          {data.contacts.length ? (
            <View style={styles.choiceWrap}>
              {data.contacts.map((contact) => (
                <ChoiceChip
                  key={contact.id}
                  label={contact.name}
                  selected={actionInviteeIds.includes(contact.id)}
                  onPress={() => toggleActionInvitee(contact.id)}
                />
              ))}
            </View>
          ) : (
            <View style={styles.contactsHint}>
              <Text style={styles.contactsHintText}>
                Primero guarda contactos desde la pantalla principal para invitarlos aquí.
              </Text>
            </View>
          )}
          <Text style={styles.fieldLabel}>Fase</Text>
          <View style={styles.choiceWrap}>
            {orderedStatuses(project).map((status) => (
              <StatusChoice
                key={status.id}
                status={status}
                selected={actionStatusId === status.id}
                onPress={() => setActionStatusId(status.id)}
              />
            ))}
          </View>
          <View style={styles.switchRow}>
            <View style={styles.switchCopy}>
              <Text style={styles.switchTitle}>Recordatorio en el celular</Text>
              <Text style={styles.switchHint}>
                Actívalo para elegir cuándo quieres que Organiza te avise.
              </Text>
            </View>
            <Switch
              value={actionRemindersEnabled}
              onValueChange={setActionRemindersEnabled}
              trackColor={{ false: '#D8D5E8', true: '#8DBFAF' }}
            />
          </View>
          {actionRemindersEnabled ? (
            <>
              <Text style={styles.fieldLabel}>¿Cuándo recordarte?</Text>
              <Text style={styles.fieldHelper}>
                Si no agregas hora, se toma 9:00 a. m.
              </Text>
              <View style={styles.choiceWrap}>
                {REMINDER_OPTIONS.map((option) => (
                  <ChoiceChip
                    key={option.label}
                    label={option.label}
                    selected={actionReminderMinutes === option.minutes}
                    onPress={() => setActionReminderMinutes(option.minutes ?? 60)}
                  />
                ))}
              </View>
            </>
          ) : null}
          <PrimaryButton
            label={action ? 'Guardar cambios' : 'Agregar a la tabla'}
            onPress={() => void saveAction(modal.projectId, modal.actionId)}
          />
          {action ? (
            <Pressable
              style={styles.deleteButton}
              onPress={() => deleteAction(modal.projectId, action.id)}
            >
              <Text style={styles.deleteButtonText}>Eliminar acción</Text>
            </Pressable>
          ) : null}
        </BottomSheet>
      );
    }

    const { project, action } = findAction(modal.projectId, modal.actionId);
    if (!project || !action) {
      return null;
    }
    return (
      <BottomSheet title="Cambiar fase" onClose={() => setModal(null)}>
        <Text style={styles.sheetDescription}>
          El resumen se actualiza en cuanto elijas una fase.
        </Text>
        <View style={styles.statusList}>
          {orderedStatuses(project).map((status) => (
            <Pressable
              key={status.id}
              style={[
                styles.statusOption,
                status.id === action.statusId && {
                  backgroundColor: status.color + '12',
                  borderColor: status.color,
                },
              ]}
              onPress={() => setActionStatus(project.id, action.id, status.id)}
            >
              <View style={[styles.statusDot, { backgroundColor: status.color }]} />
              <Text
                style={[
                  styles.statusOptionText,
                  status.id === action.statusId && { color: status.color },
                ]}
              >
                {status.label}
              </Text>
              {status.id === action.statusId ? (
                <Text style={[styles.checkmark, { color: status.color }]}>✓</Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      </BottomSheet>
    );
  }

  function renderQuickDate() {
    if (!quickDate) {
      return null;
    }
    return (
      <BottomSheet title="Fecha de entrega" onClose={() => setQuickDate(null)}>
        <Text style={styles.sheetDescription}>Elige la fecha directamente en el calendario.</Text>
        <DateTimePicker
          value={quickDate.value}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={(_, date) => {
            if (!date) {
              if (Platform.OS === 'android') {
                setQuickDate(null);
              }
              return;
            }
            if (Platform.OS === 'android') {
              void applyQuickDate(quickDate.projectId, quickDate.actionId, date);
              setQuickDate(null);
              return;
            }
            setQuickDate((current) => (current ? { ...current, value: date } : current));
          }}
        />
        {Platform.OS === 'ios' ? (
          <PrimaryButton
            label="Usar esta fecha"
            onPress={() => {
              void applyQuickDate(quickDate.projectId, quickDate.actionId, quickDate.value);
              setQuickDate(null);
            }}
          />
        ) : null}
      </BottomSheet>
    );
  }

  if (!ready) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.loading}>
          <Text style={styles.loadingMark}>▦</Text>
          <Text style={styles.loadingText}>Preparando tus casos…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      {renderMainScreen()}
      {renderModal()}
      {renderQuickDate()}
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <OrganizaApp />
    </SafeAreaProvider>
  );
}

function HomeScreen({
  projects,
  layout,
  onNewProject,
  onOpenProject,
  onOpenContacts,
  onOpenSummary,
}: {
  projects: ProjectListItem[];
  layout: MobileLayout;
  onNewProject: () => void;
  onOpenProject: (projectId: string) => void;
  onOpenContacts: () => void;
  onOpenSummary: () => void;
}) {
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.homeContent,
        { paddingHorizontal: layout.edge, paddingTop: layout.compact ? 8 : 12 },
      ]}
    >
      <View style={styles.homeHeader}>
        <View style={styles.homeHeaderCopy}>
          <Text style={styles.eyebrow}>ORGANIZA EN UN SOLO LUGAR</Text>
          <Text style={[styles.homeTitle, layout.compact && styles.homeTitleCompact]}>Mis casos</Text>
          <Text style={[styles.homeSubtitle, { maxWidth: layout.width - layout.edge * 2 - 94 }]}>
            Abre uno y trabaja en su tabla de acciones.
          </Text>
        </View>
        <Pressable
          style={[styles.homeSummaryButton, layout.compact && styles.homeSummaryButtonCompact]}
          onPress={onOpenSummary}
          accessibilityRole="button"
          accessibilityLabel="Abrir resumen"
        >
          <Text style={styles.homeSummaryButtonIcon}>▦</Text>
          <Text style={styles.homeSummaryButtonText}>Resumen</Text>
        </Pressable>
      </View>

      <View style={styles.sectionHeading}>
        <Text style={styles.sectionTitle}>Casos</Text>
        <Text style={styles.sectionCount}>{projects.length}</Text>
        <Pressable style={styles.contactsShortcut} onPress={onOpenContacts}>
          <Text style={styles.contactsShortcutText}>Contactos</Text>
        </Pressable>
      </View>

      {projects.length ? (
        projects.map(({ project, counts, state }) => (
          <Pressable
            key={project.id}
            style={styles.projectCard}
            onPress={() => onOpenProject(project.id)}
          >
            <View style={styles.projectCardTop}>
              <View style={styles.projectIcon}>
                <Text style={styles.projectIconText}>{project.title.slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={styles.projectCopy}>
                <Text style={styles.projectCardTitle}>{project.title}</Text>
                <Text style={styles.projectCardSubtext}>
                  {project.actions.length === 1
                    ? '1 acción'
                    : project.actions.length + ' acciones'}{' '}
                  · {state}
                </Text>
              </View>
              <Text style={styles.projectArrow}>›</Text>
            </View>
            <View style={styles.projectCounts}>
              {counts.map(({ status, count }) => (
                <View key={status.id} style={styles.miniCount}>
                  <View style={[styles.miniCountDot, { backgroundColor: status.color }]} />
                  <Text style={styles.miniCountText}>{count}</Text>
                  <Text style={styles.miniCountLabel}>{status.label}</Text>
                </View>
              ))}
            </View>
          </Pressable>
        ))
      ) : (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyIcon}>▦</Text>
          <Text style={styles.emptyTitle}>Crea tu primer caso</Text>
          <Text style={styles.emptyText}>
            Dentro tendrás una tabla sencilla para registrar cada tarea o acción.
          </Text>
        </View>
      )}

      <Pressable style={styles.newProjectButton} onPress={onNewProject}>
        <Text style={styles.newProjectPlus}>＋</Text>
        <Text style={styles.newProjectText}>Crear caso</Text>
      </Pressable>
    </ScrollView>
  );
}

function SummaryScreen({
  projects,
  layout,
  onBack,
  onOpenProject,
}: {
  projects: ProjectListItem[];
  layout: MobileLayout;
  onBack: () => void;
  onOpenProject: (projectId: string) => void;
}) {
  const phases = summaryPhasesForProjects(projects);
  const rows = projects.map((item) => {
    const stateStatus = item.counts.find(({ status }) => status.label === item.state)?.status;
    const stateColor =
      stateStatus?.color ||
      (item.state === 'En proceso'
        ? STATUS_COLORS[1]
        : item.state === 'Sin acciones'
          ? '#71828D'
          : STATUS_COLORS[0]);
    const total = item.project.actions.length;

    return {
      ...item,
      phaseCounts: summaryPhaseCountsForProject(item.project, phases),
      total,
      isComplete:
        total > 0 &&
        item.project.actions.every((action) => action.statusId === item.project.completedStatusId),
      stateColor,
    };
  });

  const totals = rows.reduce(
    (current, row) => {
      if (row.isComplete) {
        current.completed += 1;
      } else {
        current.active += 1;
      }
      return current;
    },
    { active: 0, completed: 0 },
  );

  const phaseTotals = phases.reduce<Record<string, number>>((current, phase) => {
    current[phase.key] = rows.reduce(
      (total, row) => total + row.phaseCounts[phase.key],
      0,
    );
    return current;
  }, {});

  const indicators = [
    {
      id: 'active-cases',
      label: 'Casos activos',
      value: totals.active,
      color: '#D1852D',
      background: '#FFF5E7',
    },
    {
      id: 'completed-cases',
      label: 'Casos realizados',
      value: totals.completed,
      color: '#2F8A67',
      background: '#EAF8F0',
    },
    ...phases.map((phase) => ({
      id: 'phase-' + phase.key,
      label: phase.label,
      value: phaseTotals[phase.key],
      color: phase.color,
      background: phase.color + '1C',
    })),
  ];

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.summaryScreenContent,
        { paddingHorizontal: layout.edge, paddingTop: layout.compact ? 6 : 10 },
      ]}
    >
      <View style={styles.summaryScreenHeader}>
        <Pressable style={styles.backButton} onPress={onBack} accessibilityLabel="Volver a mis casos">
          <Text style={styles.backButtonText}>‹</Text>
        </Pressable>
        <Text style={styles.breadcrumb}>RESUMEN</Text>
        <View style={styles.headerSpacer} />
      </View>

      <Text style={[styles.summaryScreenTitle, layout.compact && styles.summaryScreenTitleCompact]}>
        Resumen
      </Text>
      <Text style={styles.summaryScreenIntro}>
        Consulta el estado de todos tus casos y sus acciones en un solo lugar.
      </Text>

      <View style={styles.summaryIndicators}>
        {indicators.map((indicator) => (
          <View
            key={indicator.id}
            style={[
              styles.summaryIndicator,
              {
                width: (layout.width - layout.edge * 2 - 10) / 2,
                backgroundColor: indicator.background,
              },
            ]}
          >
            <Text style={[styles.summaryIndicatorNumber, { color: indicator.color }]}>
              {indicator.value}
            </Text>
            <Text style={styles.summaryIndicatorLabel}>{indicator.label}</Text>
          </View>
        ))}
      </View>

      <View style={styles.summaryBlockHeading}>
        <View>
          <Text style={styles.sectionTitle}>Acciones por caso</Text>
          <Text style={styles.summaryBlockHint}>
            El color muestra cuántas hay en cada fase de tus casos.
          </Text>
        </View>
      </View>

      <View style={styles.summaryChartCard}>
        <View style={styles.summaryChartLegend}>
          {phases.map((phase) => (
            <View key={phase.key} style={styles.summaryLegendItem}>
              <View style={[styles.summaryLegendDot, { backgroundColor: phase.color }]} />
              <Text style={styles.summaryLegendText}>{phase.label}</Text>
            </View>
          ))}
        </View>

        {rows.length ? (
          rows.map((row) => (
            <Pressable
              key={row.project.id}
              style={styles.summaryChartRow}
              onPress={() => onOpenProject(row.project.id)}
              accessibilityLabel={'Abrir caso ' + row.project.title}
            >
              <View style={styles.summaryChartRowTop}>
                <View style={styles.summaryChartTitleWrap}>
                  <Text style={styles.summaryChartTitle} numberOfLines={1}>
                    {row.project.title}
                  </Text>
                  <Text style={styles.summaryChartSubtitle}>
                    {row.total === 1 ? '1 acción' : row.total + ' acciones'}
                  </Text>
                </View>
                <Text style={styles.summaryChartTotal}>Total {row.total}</Text>
              </View>
              <View style={styles.summaryBarTrack}>
                {phases.map((phase) =>
                  row.phaseCounts[phase.key] ? (
                    <View
                      key={phase.key}
                      style={[
                        styles.summaryBarSegment,
                        { flex: row.phaseCounts[phase.key], backgroundColor: phase.color },
                      ]}
                    />
                  ) : null,
                )}
              </View>
              <View style={styles.summaryChartCounts}>
                {phases.map((phase) =>
                  row.phaseCounts[phase.key] ? (
                    <View key={phase.key} style={styles.summaryChartPhaseCount}>
                      <View style={[styles.summaryLegendDot, { backgroundColor: phase.color }]} />
                      <Text style={styles.summaryChartCount}>
                        {phase.label + ' ' + row.phaseCounts[phase.key]}
                      </Text>
                    </View>
                  ) : null,
                )}
                <Text style={styles.summaryChartOpen}>Ver caso ›</Text>
              </View>
            </Pressable>
          ))
        ) : (
          <View style={styles.summaryChartEmpty}>
            <Text style={styles.emptyTitle}>Aún no hay casos</Text>
            <Text style={styles.emptyText}>Crea un caso para que aparezca su resumen aquí.</Text>
          </View>
        )}
      </View>

      <View style={styles.summaryTableHeading}>
        <View>
          <Text style={styles.sectionTitle}>Detalle por caso</Text>
          <Text style={styles.summaryBlockHint}>
            Las columnas se actualizan con las fases de tus casos.
          </Text>
        </View>
        <Text style={styles.tableSwipe}>↔</Text>
      </View>

      <ScrollView
        horizontal
        style={styles.summaryTableScroll}
        contentContainerStyle={styles.summaryTableScrollContent}
        showsHorizontalScrollIndicator
      >
        <View style={[styles.summaryTable, { minWidth: 382 + phases.length * 112 }]}>
          <View style={styles.summaryTableHeader}>
            <View style={[styles.summaryTableCell, styles.summaryTableHeaderCell, { width: 180 }]}>
              <Text style={styles.summaryTableHeaderText}>CASO / PROYECTO</Text>
            </View>
            <View style={[styles.summaryTableCell, styles.summaryTableHeaderCell, { width: 132 }]}>
              <Text style={styles.summaryTableHeaderText}>ESTATUS GENERAL</Text>
            </View>
            {phases.map((phase) => (
              <View
                key={phase.key}
                style={[styles.summaryTableCell, styles.summaryTableHeaderCell, { width: 112 }]}
              >
                <Text style={styles.summaryTableHeaderText}>
                  {phase.label.toLocaleUpperCase('es-MX')}
                </Text>
              </View>
            ))}
            <View style={[styles.summaryTableCell, styles.summaryTableHeaderCell, styles.summaryTableCellLast, { width: 70 }]}>
              <Text style={styles.summaryTableHeaderText}>TOTAL</Text>
            </View>
          </View>

          {rows.length ? (
            rows.map((row, index) => (
              <Pressable
                key={row.project.id}
                style={[styles.summaryTableRow, index % 2 === 0 ? styles.summaryTableRowTinted : null]}
                onPress={() => onOpenProject(row.project.id)}
                accessibilityLabel={'Abrir caso ' + row.project.title}
              >
                <View style={[styles.summaryTableCell, { width: 180 }]}>
                  <Text style={styles.summaryTableProjectName} numberOfLines={2}>
                    {row.project.title}
                  </Text>
                  <Text style={styles.summaryTableProjectHint}>Toca para abrir</Text>
                </View>
                <View style={[styles.summaryTableCell, { width: 132 }]}>
                  <View style={[styles.summaryTableStatus, { backgroundColor: row.stateColor + '1C' }]}>
                    <Text style={[styles.summaryTableStatusText, { color: row.stateColor }]} numberOfLines={2}>
                      {row.state}
                    </Text>
                  </View>
                </View>
                {phases.map((phase) => (
                  <View
                    key={phase.key}
                    style={[styles.summaryTableCell, styles.summaryTableCellCenter, { width: 112 }]}
                  >
                    <Text style={styles.summaryTableNumber}>{row.phaseCounts[phase.key]}</Text>
                  </View>
                ))}
                <View style={[styles.summaryTableCell, styles.summaryTableCellCenter, styles.summaryTableCellLast, { width: 70 }]}>
                  <Text style={styles.summaryTableNumber}>{row.total}</Text>
                </View>
              </Pressable>
            ))
          ) : (
            <View style={styles.summaryTableEmpty}>
              <Text style={styles.emptyTitle}>El resumen está listo.</Text>
              <Text style={styles.emptyText}>Agrega un caso para empezar a ver los datos.</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </ScrollView>
  );
}

function ContactsScreen({
  contacts,
  layout,
  onBack,
  onNewContact,
  onEditContact,
}: {
  contacts: Contact[];
  layout: MobileLayout;
  onBack: () => void;
  onNewContact: () => void;
  onEditContact: (contactId: string) => void;
}) {
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.contactsContent,
        { paddingHorizontal: layout.edge, paddingTop: layout.compact ? 6 : 10 },
      ]}
    >
      <View style={styles.contactsHeader}>
        <Pressable style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>‹</Text>
        </Pressable>
        <Text style={styles.breadcrumb}>CONTACTOS</Text>
        <View style={styles.headerSpacer} />
      </View>

      <Text style={[styles.contactsTitle, layout.compact && styles.contactsTitleCompact]}>Contactos</Text>
      <Text style={styles.contactsIntro}>
        Guarda sus correos una vez y selecciónalos al crear una invitación de Calendar.
      </Text>

      <View style={styles.sectionHeading}>
        <Text style={styles.sectionTitle}>Lista</Text>
        <Text style={styles.sectionCount}>{contacts.length}</Text>
      </View>

      {contacts.length ? (
        contacts.map((contact) => (
          <Pressable
            key={contact.id}
            style={styles.contactCard}
            onPress={() => onEditContact(contact.id)}
          >
            <View style={styles.contactAvatar}>
              <Text style={styles.contactAvatarText}>{contact.name.slice(0, 1).toUpperCase()}</Text>
            </View>
            <View style={styles.contactCopy}>
              <Text style={styles.contactName}>{contact.name}</Text>
              <Text style={styles.contactEmail} numberOfLines={1}>{contact.email}</Text>
            </View>
            <Text style={styles.projectArrow}>›</Text>
          </Pressable>
        ))
      ) : (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyIcon}>✉</Text>
          <Text style={styles.emptyTitle}>Aún no hay contactos</Text>
          <Text style={styles.emptyText}>
            Agrega a las personas a quienes normalmente invitas a reuniones.
          </Text>
        </View>
      )}

      <Pressable style={styles.newProjectButton} onPress={onNewContact}>
        <Text style={styles.newProjectPlus}>＋</Text>
        <Text style={styles.newProjectText}>Agregar contacto</Text>
      </Pressable>
    </ScrollView>
  );
}

function ProjectScreen({
  project,
  contacts,
  layout,
  onBack,
  onNewAction,
  onEditAction,
  onPickDate,
  onChangeStatus,
  onSyncCalendar,
  onChooseCalendar,
  onOpenSettings,
}: {
  project: Project;
  contacts: Contact[];
  layout: MobileLayout;
  onBack: () => void;
  onNewAction: () => void;
  onEditAction: (actionId: string) => void;
  onPickDate: (actionId: string, value: Date) => void;
  onChangeStatus: (actionId: string) => void;
  onSyncCalendar: (action: Action) => void;
  onChooseCalendar: () => void;
  onOpenSettings: () => void;
}) {
  const phases = countByStatus(project);
  const state = generalProjectState(project);
  const stateStatus = phases.find(({ status }) => status.label === state)?.status;
  const stateColor =
    stateStatus?.color ||
    (state === 'En proceso'
      ? STATUS_COLORS[1]
      : state === 'Sin acciones'
        ? '#71828D'
        : STATUS_COLORS[0]);
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.projectContent, { paddingTop: layout.compact ? 6 : 10 }]}
    >
      <View style={[styles.projectHeader, { paddingHorizontal: layout.edge }]}>
        <Pressable style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>‹</Text>
        </Pressable>
        <Text style={styles.breadcrumb}>MIS CASOS</Text>
        <Pressable
          style={styles.caseSettingsButton}
          onPress={onOpenSettings}
          accessibilityLabel="Configuración del caso"
        >
          <Text style={styles.caseSettingsButtonText}>•••</Text>
        </Pressable>
      </View>

      <Text
        style={[
          styles.projectTitle,
          { paddingHorizontal: layout.edge },
          layout.compact && styles.projectTitleCompact,
        ]}
      >
        {project.title}
      </Text>
      <Text style={[styles.projectIntro, { paddingHorizontal: layout.edge }]}>
        {project.description || 'Registra y actualiza tus acciones directamente desde la tabla.'}
      </Text>

      <Pressable
        style={[styles.caseCalendarButton, { marginHorizontal: layout.edge }]}
        onPress={onChooseCalendar}
      >
        <View style={styles.caseCalendarCopy}>
          <Text style={styles.caseCalendarTitle}>GOOGLE CALENDAR</Text>
          <Text style={styles.caseCalendarText} numberOfLines={1}>
            {project.useGoogleCalendar && project.calendarTitle
              ? project.calendarTitle + (project.calendarAccount ? ' · ' + project.calendarAccount : '')
              : 'Sin conectar'}
          </Text>
        </View>
        <Text style={styles.caseCalendarAction}>
          {project.useGoogleCalendar ? 'Cambiar' : 'Conectar'}
        </Text>
      </Pressable>

      <View style={[styles.summaryCard, { marginHorizontal: layout.edge }]}>
        <View style={[styles.summaryExcelHeader, layout.compact && styles.summaryExcelHeaderCompact]}>
          <View>
            <Text style={styles.summaryEyebrow}>AVANCE GENERAL</Text>
            <Text style={styles.summaryActionCount}>
              {project.actions.length === 1
                ? '1 acción en la tabla'
                : project.actions.length + ' acciones en la tabla'}
            </Text>
          </View>
          <View style={styles.summaryStateGroup}>
            <Text style={styles.summaryEyebrow}>ESTATUS GENERAL</Text>
            <View
              style={[
                styles.summaryStateBadge,
                { backgroundColor: stateColor + '20' },
              ]}
            >
              <Text style={[styles.summaryState, { color: stateColor }]}>{state.toUpperCase()}</Text>
            </View>
          </View>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.summaryMetrics}
        >
          {phases.map(({ status, count }) => (
            <View
              key={status.id}
              style={[styles.summaryMetric, { backgroundColor: status.color + '1C' }]}
            >
              <Text style={[styles.summaryMetricNumber, { color: status.color }]}>{count}</Text>
              <Text style={[styles.summaryMetricLabel, { color: status.color }]}>{status.label}</Text>
            </View>
          ))}
        </ScrollView>
      </View>

      <View style={[styles.tableHeading, { paddingHorizontal: layout.edge }]}>
        <View>
          <Text style={styles.sectionTitle}>Tabla de acciones</Text>
          <Text style={styles.tableHint}>Desliza lateralmente para ver todas las columnas.</Text>
        </View>
        <Text style={styles.tableSwipe}>↔</Text>
      </View>

      <ActionTable
        project={project}
        contacts={contacts}
        layout={layout}
        onEditAction={onEditAction}
        onPickDate={onPickDate}
        onChangeStatus={onChangeStatus}
        onSyncCalendar={onSyncCalendar}
      />

      <Pressable
        style={[styles.newActionButton, { marginHorizontal: layout.edge }]}
        onPress={onNewAction}
      >
        <Text style={styles.newProjectPlus}>＋</Text>
        <Text style={styles.newActionText}>Agregar acción</Text>
      </Pressable>
    </ScrollView>
  );
}

function ActionTable({
  project,
  contacts,
  layout,
  onEditAction,
  onPickDate,
  onChangeStatus,
  onSyncCalendar,
}: {
  project: Project;
  contacts: Contact[];
  layout: MobileLayout;
  onEditAction: (actionId: string) => void;
  onPickDate: (actionId: string, value: Date) => void;
  onChangeStatus: (actionId: string) => void;
  onSyncCalendar: (action: Action) => void;
}) {
  return (
    <ScrollView
      horizontal
      style={[
        styles.tableScroll,
        { marginHorizontal: layout.edge, maxHeight: layout.tableMaxHeight },
      ]}
      contentContainerStyle={styles.tableScrollContent}
      showsHorizontalScrollIndicator
    >
      <View style={styles.table}>
        <View style={styles.tableHeader}>
          <TableCell width={48} header center>
            <Text style={styles.tableHeaderText}>#</Text>
          </TableCell>
          <TableCell width={220} header>
            <Text style={styles.tableHeaderText}>TAREA / ACCIÓN</Text>
          </TableCell>
          <TableCell width={138} header>
            <Text style={styles.tableHeaderText}>FECHA DE ENTREGA</Text>
          </TableCell>
          <TableCell width={245} header>
            <Text style={styles.tableHeaderText}>OBSERVACIONES</Text>
          </TableCell>
          <TableCell width={170} header>
            <Text style={styles.tableHeaderText}>INVITADOS</Text>
          </TableCell>
          <TableCell width={145} header>
            <Text style={styles.tableHeaderText}>FASE</Text>
          </TableCell>
          <TableCell width={132} header>
            <Text style={styles.tableHeaderText}>ÚLTIMA ACTUALIZACIÓN</Text>
          </TableCell>
          <TableCell width={112} header center last>
            <Text style={styles.tableHeaderText}>GOOGLE{`\n`}CALENDAR</Text>
          </TableCell>
        </View>

        {project.actions.length ? (
          project.actions.map((action, index) => {
            const status = statusFor(project, action.statusId);
            const invitees = selectedInvitees(action, contacts);
            const hasCalendarConnection = project.useGoogleCalendar && Boolean(project.calendarId);
            const eventIsSynced = hasCalendarConnection && Boolean(action.calendarEventId);
            const calendarLabel = !action.dueDate
              ? 'Sin fecha'
              : eventIsSynced
                ? '✓ Agendado'
                : hasCalendarConnection
                  ? 'Sincronizar'
                  : 'Conectar';
            return (
              <View
                key={action.id}
                style={[styles.tableRow, index % 2 === 0 ? styles.tableRowBlue : styles.tableRowWhite]}
              >
                <TableCell width={48} center>
                  <Text style={styles.tableIndex}>{index + 1}</Text>
                </TableCell>
                <TableCell width={220}>
                  <Pressable style={styles.tableCellButton} onPress={() => onEditAction(action.id)}>
                    <Text style={styles.tableActionTitle} numberOfLines={2}>
                      {action.title}
                    </Text>
                    <Text style={styles.tableEditText}>Tocar para editar</Text>
                  </Pressable>
                </TableCell>
                <TableCell width={138}>
                  <Pressable
                    style={styles.tableCellButton}
                    onPress={() => onPickDate(action.id, fromDateKey(action.dueDate, action.dueTime))}
                  >
                    <Text style={action.dueDate ? styles.tableDateText : styles.tableDatePlaceholder}>
                      {action.dueDate ? formatDate(action.dueDate) : '＋ Fecha'}
                    </Text>
                    {action.dueTime ? <Text style={styles.tableTimeText}>{action.dueTime}</Text> : null}
                  </Pressable>
                </TableCell>
                <TableCell width={245}>
                  <Pressable style={styles.tableCellButton} onPress={() => onEditAction(action.id)}>
                    <Text
                      style={action.observations ? styles.tableObservation : styles.tableObservationPlaceholder}
                      numberOfLines={3}
                    >
                      {action.observations || 'Agregar observación'}
                    </Text>
                  </Pressable>
                </TableCell>
                <TableCell width={170}>
                  <Pressable style={styles.tableCellButton} onPress={() => onEditAction(action.id)}>
                    <Text
                      style={
                        invitees.length
                          ? styles.tableInvitees
                          : styles.tableInviteesPlaceholder
                      }
                      numberOfLines={2}
                    >
                      {invitees.length
                        ? invitees.slice(0, 2).map((contact) => contact.name).join(', ') +
                          (invitees.length > 2 ? ' +' + (invitees.length - 2) : '')
                        : 'Agregar invitados'}
                    </Text>
                    {invitees.length ? (
                      <Text style={styles.tableEditText}>
                        {invitees.length === 1 ? '1 contacto' : invitees.length + ' contactos'}
                      </Text>
                    ) : null}
                  </Pressable>
                </TableCell>
                <TableCell width={145}>
                  <Pressable
                    style={[styles.tableStatus, { backgroundColor: status.color + '1F' }]}
                    onPress={() => onChangeStatus(action.id)}
                  >
                    <View style={[styles.statusDot, { backgroundColor: status.color }]} />
                    <Text style={[styles.tableStatusText, { color: status.color }]} numberOfLines={1}>
                      {status.label}
                    </Text>
                    <Text style={[styles.statusChevron, { color: status.color }]}>⌄</Text>
                  </Pressable>
                </TableCell>
                <TableCell width={132}>
                  <Text style={styles.tableUpdated}>{formatUpdated(action.updatedAt)}</Text>
                </TableCell>
                <TableCell width={112} center last>
                  <Pressable
                    style={[
                      styles.calendarCellButton,
                      eventIsSynced
                        ? styles.calendarCellSynced
                        : action.dueDate && hasCalendarConnection
                          ? styles.calendarCellActive
                          : styles.calendarCellInactive,
                    ]}
                    onPress={() => onSyncCalendar(action)}
                  >
                    <Text
                      style={[
                        styles.calendarCellText,
                        eventIsSynced
                          ? styles.calendarCellTextSynced
                          : action.dueDate && hasCalendarConnection
                            ? styles.calendarCellTextActive
                            : styles.calendarCellTextInactive,
                      ]}
                    >
                      {calendarLabel}
                    </Text>
                  </Pressable>
                </TableCell>
              </View>
            );
          })
        ) : (
          <View style={styles.tableEmptyRow}>
            <Text style={styles.tableEmptyTitle}>La tabla está lista.</Text>
            <Text style={styles.tableEmptyText}>Agrega tu primera acción con el botón de abajo.</Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

function TableCell({
  width,
  header = false,
  center = false,
  last = false,
  children,
}: {
  width: number;
  header?: boolean;
  center?: boolean;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <View
      style={[
        styles.tableCell,
        { width },
        header && styles.tableHeaderCell,
        center && styles.tableCellCenter,
        last && styles.tableCellLast,
      ]}
    >
      {children}
    </View>
  );
}

function Field({
  label,
  helper,
  multiline,
  autoCapitalize = 'sentences',
  autoCorrect,
  ...inputProps
}: {
  label: string;
  helper?: string;
  multiline?: boolean;
  value: string;
  placeholder?: string;
  onChangeText: (text: string) => void;
  keyboardType?: 'default' | 'email-address';
  autoCapitalize?: 'none' | 'sentences' | 'words';
  autoCorrect?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {helper ? <Text style={styles.fieldHelper}>{helper}</Text> : null}
      <TextInput
        style={[styles.input, multiline && styles.inputMultiline]}
        placeholderTextColor="#9BA1AA"
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        {...inputProps}
      />
    </View>
  );
}

function ChoiceChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.choiceChip, selected && styles.choiceChipSelected]} onPress={onPress}>
      <Text style={[styles.choiceChipText, selected && styles.choiceChipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function CalendarAccountTools({
  loading,
  onAddAccount,
  onRefresh,
}: {
  loading: boolean;
  onAddAccount: () => void;
  onRefresh: () => void;
}) {
  return (
    <View style={styles.calendarAccountTools}>
      <Pressable
        style={[styles.addGoogleAccountButton, loading && styles.calendarToolDisabled]}
        onPress={onAddAccount}
        disabled={loading}
      >
        <Text style={styles.addGoogleAccountTitle}>＋ Agregar otra cuenta Google</Text>
        <Text style={styles.addGoogleAccountText}>
          Se abre Ajustes para agregarla al teléfono; Organiza no te pide contraseñas.
        </Text>
      </Pressable>
      <Pressable
        style={[styles.refreshCalendarsButton, loading && styles.calendarToolDisabled]}
        onPress={onRefresh}
        disabled={loading}
      >
        <Text style={styles.refreshCalendarsText}>↻ Actualizar calendarios</Text>
        <Text style={styles.addGoogleAccountText}>
          Muestra los calendarios Google que ya están configurados en este teléfono.
        </Text>
      </Pressable>
    </View>
  );
}

function StatusChoice({
  status,
  selected,
  onPress,
}: {
  status: Status;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[
        styles.statusChoice,
        selected && { borderColor: status.color, backgroundColor: status.color + '12' },
      ]}
      onPress={onPress}
    >
      <View style={[styles.statusDot, { backgroundColor: status.color }]} />
      <Text style={[styles.statusChoiceText, selected && { color: status.color }]}>{status.label}</Text>
    </Pressable>
  );
}

function PrimaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.primaryButton} onPress={onPress}>
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

function BottomSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [keyboardTop, setKeyboardTop] = useState<number | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }

    const shown = Keyboard.addListener('keyboardDidShow', (event) => {
      setKeyboardTop(event.endCoordinates.screenY);
    });
    const hidden = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardTop(null);
    });

    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  const compact = width < 380 || height < 700;
  const visibleHeight = keyboardTop ? Math.min(height, keyboardTop) : height;
  const availableHeight = Math.max(
    320,
    visibleHeight - insets.top - Math.max(insets.bottom, 10),
  );
  const sheetMaxHeight = Math.min(Math.round(availableHeight * 0.93), 720);
  const scrollMaxHeight = Math.max(150, sheetMaxHeight - (compact ? 74 : 86));
  // On Android some modal windows do not resize when the keyboard appears.
  // Move this sheet only by the portion that still overlaps the keyboard.
  const androidKeyboardOffset =
    Platform.OS === 'android' && keyboardTop ? Math.max(0, height - keyboardTop) : 0;

  return (
    <Modal transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={[styles.modalRoot, { paddingBottom: androidKeyboardOffset }]}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        <KeyboardAvoidingView
          style={[
            styles.sheetKeyboard,
            { maxHeight: sheetMaxHeight, paddingBottom: Math.max(insets.bottom, 10) },
          ]}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={insets.top}
        >
          <View style={[styles.bottomSheet, { maxHeight: sheetMaxHeight }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{title}</Text>
              <Pressable style={styles.closeButton} onPress={onClose}>
                <Text style={styles.closeButtonText}>×</Text>
              </Pressable>
            </View>
            <ScrollView
              style={[styles.sheetScroll, { maxHeight: scrollMaxHeight }]}
              contentContainerStyle={[
                styles.sheetContent,
                { paddingBottom: Math.max(compact ? 24 : 31, insets.bottom + 12) },
              ]}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F6F9FB',
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingMark: {
    color: '#176A89',
    fontSize: 30,
  },
  loadingText: {
    color: '#52606B',
    fontSize: 15,
  },
  screen: {
    flex: 1,
  },
  homeContent: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 22,
  },
  contactsContent: {
    paddingTop: 12,
    paddingHorizontal: 20,
    paddingBottom: 22,
  },
  summaryScreenContent: {
    paddingTop: 12,
    paddingHorizontal: 20,
    paddingBottom: 28,
  },
  summaryScreenHeader: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  summaryScreenTitle: {
    color: '#14364B',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.8,
    marginTop: 14,
  },
  summaryScreenTitleCompact: {
    fontSize: 24,
    marginTop: 10,
  },
  summaryScreenIntro: {
    color: '#71808A',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  summaryIndicators: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 17,
  },
  summaryIndicator: {
    minHeight: 86,
    borderRadius: 15,
    paddingHorizontal: 12,
    paddingVertical: 12,
    justifyContent: 'space-between',
  },
  summaryIndicatorNumber: {
    fontSize: 25,
    fontWeight: '800',
  },
  summaryIndicatorLabel: {
    color: '#526D7B',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },
  summaryBlockHeading: {
    marginTop: 25,
    marginBottom: 10,
  },
  summaryBlockHint: {
    color: '#7A8993',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 3,
  },
  summaryChartCard: {
    borderWidth: 1,
    borderColor: '#C9DEE8',
    borderRadius: 17,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  summaryChartLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: 13,
    paddingVertical: 11,
    backgroundColor: '#F3F8FA',
    borderBottomWidth: 1,
    borderBottomColor: '#E3EDF1',
  },
  summaryLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  summaryLegendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  summaryLegendText: {
    color: '#55707E',
    fontSize: 10,
    fontWeight: '700',
  },
  summaryChartRow: {
    paddingHorizontal: 13,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E9F0F3',
  },
  summaryChartRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  summaryChartTitleWrap: {
    flex: 1,
  },
  summaryChartTitle: {
    color: '#244355',
    fontSize: 13,
    fontWeight: '800',
  },
  summaryChartSubtitle: {
    color: '#7A8993',
    fontSize: 10,
    marginTop: 2,
  },
  summaryChartTotal: {
    color: '#315567',
    fontSize: 11,
    fontWeight: '800',
  },
  summaryBarTrack: {
    height: 12,
    borderRadius: 7,
    backgroundColor: '#EAF0F2',
    flexDirection: 'row',
    overflow: 'hidden',
    marginTop: 9,
  },
  summaryBarSegment: {
    height: '100%',
  },
  summaryChartCounts: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 7,
  },
  summaryChartPhaseCount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  summaryChartCount: {
    color: '#667B86',
    fontSize: 10,
    fontWeight: '700',
  },
  summaryChartOpen: {
    color: '#176A89',
    fontSize: 10,
    fontWeight: '800',
    marginLeft: 'auto',
  },
  summaryChartEmpty: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 27,
  },
  summaryTableHeading: {
    marginTop: 25,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  summaryTableScroll: {
    borderRadius: 15,
  },
  summaryTableScrollContent: {
    paddingBottom: 8,
  },
  summaryTable: {
    minWidth: 692,
    borderWidth: 1,
    borderColor: '#BFD9E5',
    borderRadius: 15,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  summaryTableHeader: {
    minHeight: 52,
    flexDirection: 'row',
    backgroundColor: '#176A89',
  },
  summaryTableCell: {
    minHeight: 64,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#BFD9E5',
    paddingHorizontal: 9,
    paddingVertical: 8,
    justifyContent: 'center',
  },
  summaryTableHeaderCell: {
    minHeight: 52,
    backgroundColor: '#176A89',
    borderBottomWidth: 0,
  },
  summaryTableHeaderText: {
    color: '#FFFFFF',
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '800',
    textAlign: 'center',
  },
  summaryTableCellLast: {
    borderRightWidth: 0,
  },
  summaryTableRow: {
    minHeight: 64,
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
  },
  summaryTableRowTinted: {
    backgroundColor: '#F4FAFC',
  },
  summaryTableProjectName: {
    color: '#244355',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
  summaryTableProjectHint: {
    color: '#718591',
    fontSize: 10,
    marginTop: 3,
  },
  summaryTableStatus: {
    borderRadius: 9,
    paddingHorizontal: 7,
    paddingVertical: 5,
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  summaryTableStatusText: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '800',
    textAlign: 'center',
  },
  summaryTableCellCenter: {
    alignItems: 'center',
  },
  summaryTableNumber: {
    color: '#25495A',
    fontSize: 16,
    fontWeight: '800',
  },
  summaryTableEmpty: {
    minHeight: 112,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  homeHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  homeHeaderCopy: {
    flex: 1,
    paddingRight: 10,
  },
  eyebrow: {
    color: '#176A89',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  homeTitle: {
    color: '#14364B',
    fontSize: 29,
    fontWeight: '800',
    letterSpacing: -0.8,
    marginTop: 4,
  },
  homeTitleCompact: {
    fontSize: 25,
  },
  homeSubtitle: {
    color: '#72808B',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
    maxWidth: 270,
  },
  homeSummaryButton: {
    minWidth: 76,
    height: 40,
    borderRadius: 13,
    backgroundColor: '#DCEFF7',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 8,
  },
  homeSummaryButtonIcon: {
    color: '#176A89',
    fontSize: 16,
    fontWeight: '800',
  },
  homeSummaryButtonText: {
    color: '#176A89',
    fontSize: 11,
    fontWeight: '800',
  },
  homeSummaryButtonCompact: {
    minWidth: 72,
    height: 37,
    borderRadius: 12,
  },
  appMark: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: '#DCEFF7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  appMarkText: {
    color: '#176A89',
    fontSize: 21,
    fontWeight: '800',
  },
  appMarkCompact: {
    width: 37,
    height: 37,
    borderRadius: 12,
  },
  accountSummaryCard: {
    minHeight: 71,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D7E7ED',
    paddingHorizontal: 13,
    marginTop: 15,
    flexDirection: 'row',
    alignItems: 'center',
  },
  accountSummaryIcon: {
    width: 37,
    height: 37,
    borderRadius: 12,
    backgroundColor: '#E2F1F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountSummaryIconText: {
    color: '#176A89',
    fontSize: 16,
    fontWeight: '800',
  },
  accountSummaryCopy: {
    flex: 1,
    marginLeft: 10,
  },
  accountSummaryEyebrow: {
    color: '#71818C',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  accountSummaryTitle: {
    color: '#244355',
    fontSize: 13,
    fontWeight: '800',
    marginTop: 2,
  },
  accountSummaryStatus: {
    color: '#2E7B5D',
    fontSize: 11,
    marginTop: 2,
  },
  accountSummaryStatusError: {
    color: '#C65767',
  },
  accountSummaryArrow: {
    color: '#176A89',
    fontSize: 25,
    lineHeight: 27,
  },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 22,
    marginBottom: 10,
  },
  sectionTitle: {
    color: '#183648',
    fontSize: 18,
    fontWeight: '800',
  },
  sectionCount: {
    backgroundColor: '#E2EFF5',
    borderRadius: 10,
    color: '#176A89',
    fontSize: 12,
    fontWeight: '800',
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  contactsShortcut: {
    marginLeft: 'auto',
    borderRadius: 10,
    backgroundColor: '#E2EFF5',
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  contactsShortcutText: {
    color: '#176A89',
    fontSize: 11,
    fontWeight: '800',
  },
  projectCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 17,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#DFE9EE',
  },
  contactCard: {
    minHeight: 70,
    backgroundColor: '#FFFFFF',
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#DFE9EE',
    paddingHorizontal: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  contactAvatar: {
    width: 39,
    height: 39,
    borderRadius: 13,
    backgroundColor: '#E2F1F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactAvatarText: {
    color: '#176A89',
    fontSize: 16,
    fontWeight: '800',
  },
  contactCopy: {
    flex: 1,
    marginLeft: 11,
  },
  contactName: {
    color: '#1E3747',
    fontSize: 14,
    fontWeight: '800',
  },
  contactEmail: {
    color: '#758590',
    fontSize: 12,
    marginTop: 3,
  },
  projectCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  projectIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DCEFF7',
  },
  projectIconText: {
    color: '#176A89',
    fontSize: 17,
    fontWeight: '800',
  },
  projectCopy: {
    flex: 1,
    marginLeft: 11,
  },
  projectCardTitle: {
    color: '#1E3747',
    fontSize: 15,
    fontWeight: '800',
  },
  projectCardSubtext: {
    color: '#7B8993',
    fontSize: 12,
    marginTop: 2,
  },
  projectArrow: {
    color: '#176A89',
    fontSize: 28,
    lineHeight: 28,
  },
  projectCounts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingTop: 11,
    marginTop: 11,
    borderTopWidth: 1,
    borderTopColor: '#EDF2F5',
  },
  miniCount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  miniCountDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  miniCountText: {
    color: '#325262',
    fontSize: 13,
    fontWeight: '800',
  },
  miniCountLabel: {
    color: '#76848E',
    fontSize: 11,
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#BBD7E4',
    borderRadius: 19,
    alignItems: 'center',
    paddingHorizontal: 30,
    paddingVertical: 32,
  },
  emptyIcon: {
    color: '#176A89',
    fontSize: 27,
  },
  emptyTitle: {
    color: '#1D394B',
    fontSize: 16,
    fontWeight: '800',
    marginTop: 8,
  },
  emptyText: {
    color: '#74828D',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 4,
  },
  newProjectButton: {
    minHeight: 56,
    backgroundColor: '#DCEFF7',
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
    marginTop: 14,
  },
  newProjectPlus: {
    color: '#176A89',
    fontSize: 23,
  },
  newProjectText: {
    color: '#176A89',
    fontSize: 15,
    fontWeight: '800',
  },
  projectContent: {
    paddingTop: 12,
    paddingBottom: 22,
  },
  projectHeader: {
    paddingHorizontal: 20,
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    width: 35,
    height: 35,
    borderRadius: 12,
    backgroundColor: '#E2EFF5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButtonText: {
    color: '#176A89',
    fontSize: 30,
    fontWeight: '300',
    lineHeight: 32,
    marginTop: -3,
  },
  breadcrumb: {
    color: '#6E7E89',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  headerSpacer: {
    width: 35,
  },
  caseSettingsButton: {
    width: 35,
    height: 35,
    borderRadius: 12,
    backgroundColor: '#E2EFF5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  caseSettingsButtonText: {
    color: '#176A89',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 1,
    marginTop: -5,
  },
  projectTitle: {
    color: '#14364B',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.8,
    paddingHorizontal: 20,
    marginTop: 14,
  },
  projectTitleCompact: {
    fontSize: 24,
    marginTop: 10,
  },
  projectIntro: {
    color: '#71808A',
    fontSize: 13,
    lineHeight: 19,
    paddingHorizontal: 20,
    marginTop: 4,
  },
  contactsHeader: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  contactsTitle: {
    color: '#14364B',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.8,
    marginTop: 14,
  },
  contactsTitleCompact: {
    fontSize: 24,
    marginTop: 10,
  },
  contactsIntro: {
    color: '#71808A',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  caseCalendarButton: {
    marginHorizontal: 20,
    marginTop: 15,
    minHeight: 56,
    paddingHorizontal: 14,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#C9DEE8',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  caseCalendarCopy: {
    flex: 1,
  },
  caseCalendarTitle: {
    color: '#527080',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  caseCalendarText: {
    color: '#284A5D',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 3,
  },
  caseCalendarAction: {
    color: '#176A89',
    fontSize: 12,
    fontWeight: '800',
  },
  summaryCard: {
    marginHorizontal: 20,
    marginTop: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#C9DEE8',
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  summaryExcelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 15,
    paddingVertical: 13,
    backgroundColor: '#E7F2F7',
  },
  summaryExcelHeaderCompact: {
    alignItems: 'flex-start',
    flexDirection: 'column',
  },
  summaryEyebrow: {
    color: '#27546B',
    fontSize: 10,
    letterSpacing: 1,
    fontWeight: '800',
  },
  summaryStateGroup: {
    alignItems: 'flex-end',
  },
  summaryStateBadge: {
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 5,
    marginTop: 5,
  },
  summaryStatePending: {
    backgroundColor: '#FFF1C9',
  },
  summaryStateProgress: {
    backgroundColor: '#DDEDFC',
  },
  summaryStateDone: {
    backgroundColor: '#D9F0E5',
  },
  summaryState: {
    color: '#27546B',
    fontSize: 10,
    fontWeight: '800',
  },
  summaryActionCount: {
    color: '#567381',
    fontSize: 12,
    marginTop: 4,
  },
  summaryMetrics: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingVertical: 9,
    gap: 7,
  },
  summaryMetric: {
    width: 112,
    minHeight: 62,
    borderRadius: 11,
    paddingHorizontal: 9,
    paddingVertical: 9,
    justifyContent: 'center',
  },
  summaryMetricPending: {
    backgroundColor: '#FFF8E5',
  },
  summaryMetricProgress: {
    backgroundColor: '#EDF6FF',
  },
  summaryMetricDone: {
    backgroundColor: '#EAF8F0',
  },
  summaryMetricNumber: {
    color: '#244C60',
    fontSize: 21,
    fontWeight: '800',
  },
  summaryMetricLabel: {
    color: '#627B89',
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2,
  },
  tableHeading: {
    paddingHorizontal: 20,
    marginTop: 25,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tableHint: {
    color: '#7A8993',
    fontSize: 11,
    marginTop: 3,
  },
  tableSwipe: {
    color: '#176A89',
    fontSize: 21,
  },
  tableScroll: {
    marginHorizontal: 20,
    borderRadius: 15,
    maxHeight: 525,
  },
  tableScrollContent: {
    paddingBottom: 8,
  },
  table: {
    minWidth: 1210,
    borderWidth: 1,
    borderColor: '#BFD9E5',
    borderRadius: 15,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  tableHeader: {
    height: 58,
    flexDirection: 'row',
    backgroundColor: '#176A89',
  },
  tableHeaderCell: {
    justifyContent: 'center',
    backgroundColor: '#176A89',
    borderBottomWidth: 0,
  },
  tableHeaderText: {
    color: '#FFFFFF',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
    textAlign: 'center',
  },
  tableRow: {
    flexDirection: 'row',
    minHeight: 78,
  },
  tableRowBlue: {
    backgroundColor: '#D9F0FA',
  },
  tableRowWhite: {
    backgroundColor: '#FFFFFF',
  },
  tableCell: {
    minHeight: 78,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#BFD9E5',
    padding: 9,
    justifyContent: 'center',
  },
  tableCellCenter: {
    alignItems: 'center',
  },
  tableCellLast: {
    borderRightWidth: 0,
  },
  tableIndex: {
    color: '#24536B',
    fontSize: 14,
    fontWeight: '800',
  },
  tableCellButton: {
    flex: 1,
    justifyContent: 'center',
  },
  tableActionTitle: {
    color: '#1D4357',
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 19,
  },
  tableEditText: {
    color: '#6D8A99',
    fontSize: 10,
    marginTop: 3,
  },
  tableDateText: {
    color: '#1B516C',
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 17,
  },
  tableDatePlaceholder: {
    color: '#287391',
    fontSize: 12,
    fontWeight: '800',
  },
  tableTimeText: {
    color: '#6B8290',
    fontSize: 11,
    marginTop: 3,
  },
  tableObservation: {
    color: '#365766',
    fontSize: 12,
    lineHeight: 17,
  },
  tableObservationPlaceholder: {
    color: '#7190A0',
    fontSize: 12,
    fontStyle: 'italic',
  },
  tableInvitees: {
    color: '#35596A',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
  },
  tableInviteesPlaceholder: {
    color: '#7190A0',
    fontSize: 12,
    fontStyle: 'italic',
  },
  tableStatus: {
    minHeight: 34,
    borderRadius: 9,
    paddingHorizontal: 8,
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  tableStatusText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '800',
  },
  statusChevron: {
    fontSize: 13,
    fontWeight: '800',
  },
  tableUpdated: {
    color: '#546D7B',
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 16,
  },
  calendarCellButton: {
    borderRadius: 9,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 7,
  },
  calendarCellActive: {
    backgroundColor: '#DCEEF8',
  },
  calendarCellSynced: {
    backgroundColor: '#D2E8DF',
  },
  calendarCellInactive: {
    backgroundColor: 'rgba(113, 143, 160, 0.13)',
  },
  calendarCellText: {
    fontSize: 10,
    fontWeight: '800',
  },
  calendarCellTextActive: {
    color: '#246B92',
  },
  calendarCellTextSynced: {
    color: '#287758',
  },
  calendarCellTextInactive: {
    color: '#8094A0',
  },
  tableEmptyRow: {
    height: 150,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F9FCFD',
  },
  tableEmptyTitle: {
    color: '#2A596F',
    fontSize: 15,
    fontWeight: '800',
  },
  tableEmptyText: {
    color: '#708591',
    fontSize: 12,
    marginTop: 4,
  },
  newActionButton: {
    marginHorizontal: 20,
    minHeight: 55,
    marginTop: 8,
    backgroundColor: '#DCEFF7',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  newActionText: {
    color: '#176A89',
    fontSize: 15,
    fontWeight: '800',
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(17, 37, 49, 0.46)',
  },
  sheetKeyboard: {
    width: '100%',
    maxHeight: '88%',
    flexShrink: 1,
  },
  bottomSheet: {
    backgroundColor: '#FAFCFD',
    borderTopLeftRadius: 27,
    borderTopRightRadius: 27,
    overflow: 'hidden',
    flexShrink: 1,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 3,
    backgroundColor: '#CCDAE0',
    marginTop: 10,
  },
  sheetHeader: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetTitle: {
    color: '#183648',
    fontSize: 20,
    fontWeight: '800',
  },
  closeButton: {
    width: 31,
    height: 31,
    borderRadius: 11,
    backgroundColor: '#E2EFF5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    color: '#477187',
    fontSize: 23,
    lineHeight: 25,
    fontWeight: '300',
  },
  sheetScroll: {
    maxHeight: 630,
    flexShrink: 1,
  },
  sheetContent: {
    paddingHorizontal: 20,
    paddingBottom: 31,
  },
  field: {
    marginBottom: 17,
  },
  fieldLabel: {
    color: '#224254',
    fontSize: 13,
    fontWeight: '800',
  },
  fieldHelper: {
    color: '#81909A',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  input: {
    minHeight: 48,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#C9DCE5',
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    color: '#224254',
    fontSize: 14,
    paddingHorizontal: 13,
  },
  inputMultiline: {
    minHeight: 84,
    paddingTop: 12,
  },
  choiceWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
    marginBottom: 19,
  },
  contactsHint: {
    marginTop: 8,
    marginBottom: 19,
    borderRadius: 12,
    backgroundColor: '#EDF6F9',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  contactsHintText: {
    color: '#627B89',
    fontSize: 11,
    lineHeight: 16,
  },
  choiceChip: {
    borderWidth: 1,
    borderColor: '#C8DCE5',
    borderRadius: 13,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  choiceChipSelected: {
    borderColor: '#176A89',
    backgroundColor: '#E2F1F7',
  },
  choiceChipText: {
    color: '#61727E',
    fontSize: 12,
    fontWeight: '700',
  },
  choiceChipTextSelected: {
    color: '#176A89',
  },
  calendarSetup: {
    marginTop: -6,
    marginBottom: 2,
  },
  calendarList: {
    gap: 9,
  },
  calendarLoadingText: {
    color: '#71818C',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12,
  },
  calendarEmptyState: {
    borderRadius: 14,
    backgroundColor: '#EEF6F9',
    paddingHorizontal: 13,
    paddingVertical: 12,
    marginBottom: 11,
  },
  calendarEmptyTitle: {
    color: '#315C70',
    fontSize: 12,
    fontWeight: '800',
  },
  calendarEmptyText: {
    color: '#6B7F8B',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 3,
  },
  calendarAccountTools: {
    gap: 8,
    marginTop: 12,
  },
  addGoogleAccountButton: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#B8D9E7',
    backgroundColor: '#E8F5FA',
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  addGoogleAccountTitle: {
    color: '#176A89',
    fontSize: 12,
    fontWeight: '800',
  },
  addGoogleAccountText: {
    color: '#607C8B',
    fontSize: 10,
    lineHeight: 15,
    marginTop: 3,
  },
  refreshCalendarsButton: {
    minHeight: 42,
    borderRadius: 13,
    backgroundColor: '#F0F7FA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshCalendarsText: {
    color: '#28647D',
    fontSize: 12,
    fontWeight: '800',
  },
  calendarToolDisabled: {
    opacity: 0.55,
  },
  calendarOption: {
    minHeight: 62,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#D5E2E8',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  calendarOptionCopy: {
    flex: 1,
  },
  calendarOptionTitle: {
    color: '#224254',
    fontSize: 14,
    fontWeight: '800',
  },
  calendarOptionAccount: {
    color: '#70818C',
    fontSize: 11,
    marginTop: 3,
  },
  calendarPrimary: {
    color: '#287758',
    backgroundColor: '#E4F3EB',
    fontSize: 10,
    fontWeight: '800',
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 7,
  },
  calendarOptionArrow: {
    color: '#176A89',
    fontSize: 24,
    lineHeight: 26,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 13,
    borderRadius: 16,
    backgroundColor: '#EDF6F9',
    marginBottom: 21,
  },
  switchCopy: {
    flex: 1,
  },
  switchTitle: {
    color: '#244355',
    fontSize: 13,
    fontWeight: '800',
  },
  switchHint: {
    color: '#74848E',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 3,
  },
  primaryButton: {
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: '#176A89',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  dateField: {
    marginTop: 8,
    minHeight: 50,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#C9DCE5',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexDirection: 'row',
    paddingHorizontal: 13,
  },
  dateFieldText: {
    color: '#1E596F',
    fontSize: 14,
    fontWeight: '700',
  },
  dateFieldPlaceholder: {
    color: '#8796A0',
    fontSize: 14,
  },
  dateFieldArrow: {
    color: '#176A89',
    fontSize: 25,
    lineHeight: 27,
  },
  timeLabel: {
    marginTop: 17,
  },
  statusChoice: {
    minHeight: 38,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#C8DCE5',
    paddingHorizontal: 11,
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  statusChoiceText: {
    color: '#60717D',
    fontSize: 12,
    fontWeight: '700',
  },
  deleteButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 11,
  },
  deleteButtonText: {
    color: '#C65767',
    fontSize: 13,
    fontWeight: '800',
  },
  sheetDescription: {
    color: '#71818C',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 16,
  },
  accountModalCard: {
    borderRadius: 16,
    backgroundColor: '#EAF5F8',
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 14,
  },
  accountModalEyebrow: {
    color: '#5A7A88',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.9,
  },
  accountModalEmail: {
    color: '#1C4254',
    fontSize: 15,
    fontWeight: '800',
    marginTop: 4,
  },
  accountModalStatus: {
    color: '#287758',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
  },
  accountErrorText: {
    color: '#B64B5D',
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 14,
  },
  accountSetupHint: {
    borderRadius: 14,
    backgroundColor: '#FFF4DF',
    paddingHorizontal: 13,
    paddingVertical: 11,
    marginBottom: 16,
  },
  accountSetupHintTitle: {
    color: '#8E681E',
    fontSize: 12,
    fontWeight: '800',
  },
  accountSetupHintText: {
    color: '#8A754C',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 3,
  },
  settingsSectionLabel: {
    color: '#527080',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    marginTop: 2,
    marginBottom: 8,
  },
  settingsCalendarRow: {
    minHeight: 61,
    borderWidth: 1,
    borderColor: '#C9DEE8',
    borderRadius: 15,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 18,
  },
  settingsCalendarCopy: {
    flex: 1,
  },
  settingsCalendarTitle: {
    color: '#244355',
    fontSize: 13,
    fontWeight: '800',
  },
  settingsCalendarText: {
    color: '#70818C',
    fontSize: 11,
    marginTop: 3,
  },
  settingsCalendarAction: {
    color: '#176A89',
    fontSize: 12,
    fontWeight: '800',
  },
  statusList: {
    gap: 9,
  },
  statusOption: {
    minHeight: 52,
    borderRadius: 15,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D5E2E8',
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  statusOptionSelected: {
    backgroundColor: '#F1F8FA',
    borderColor: '#8BB8CA',
  },
  statusOptionText: {
    color: '#224254',
    fontSize: 14,
    fontWeight: '800',
    flex: 1,
  },
  checkmark: {
    color: '#176A89',
    fontSize: 17,
    fontWeight: '900',
  },
});
