export const matchesHref = (pathname: string, href: string) => {
  if (href.includes('?')) {
    const [basePath] = href.split('?');
    return pathname === basePath;
  }
  if (href === '/') return pathname === '/';
  return pathname.startsWith(href);
};

export const displayNameFromSession = (session: any) => {
  return session?.user?.user_metadata?.full_name || session?.user?.user_metadata?.name || session?.user?.email || 'Profile';
};

export const initials = (value: string) => {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0].slice(0, 1)}${parts[1].slice(0, 1)}`.toUpperCase();
};
