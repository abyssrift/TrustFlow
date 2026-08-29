export type EmptyStateVariant = 'empty' | 'denied' | 'unavailable';

export const EMPTY_STATE_DEFAULTS = {
  empty: {
    icon: 'inbox',
    title: 'Nothing here yet',
    body: 'There is nothing to show yet.',
  },
  denied: {
    icon: 'lock',
    title: "You don't have permission to view this",
    body: 'Ask an admin to grant you access if you think this is wrong.',
  },
  unavailable: {
    icon: 'lock',
    title: 'Not available here',
    body: "This isn't available on your current plan or in this context.",
  },
} as const;
