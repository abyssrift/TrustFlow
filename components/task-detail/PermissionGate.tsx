import React from 'react';

type Props = { allowed: boolean; children: React.ReactNode; fallback?: React.ReactNode };

export default function PermissionGate({ allowed, children, fallback = null }: Props) {
  return allowed ? <>{children}</> : <>{fallback}</>;
}
