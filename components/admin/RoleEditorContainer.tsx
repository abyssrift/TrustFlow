// Self-contained "create a new role" modal for #338 (ModalHost / command
// palette). RoleEditorSheet(.web) is a ~20-prop controlled presentational
// component — this container owns the state RoleBuilder normally feeds it and
// brings its own RoleManagerProvider (for the live permission list +
// rpc_create_role), so ModalHost can mount it with just onClose={dismiss}.
//
// Create mode ONLY. Edit / clone / delete + the roles list stay in
// components/admin/RoleBuilder.tsx, which keeps its own RoleEditorSheet wiring
// (it does substantially more than host the sheet). The overlap is the four
// useState lines + the template/bulk-toggle handlers below — small, and
// deduping it would mean teaching this container edit mode too. Follow-up.
import React, { useMemo, useState } from 'react';

import RoleEditorSheet from '@/components/admin/RoleEditorSheet';
import { useAlert } from '@/contexts/AlertContext';
import { RoleManagerProvider, useRoleManager } from '@/contexts/RoleManagerContext';
import type { RoleTemplate } from '@/lib/roleTemplates';

type Props = {
  visible: boolean;
  onClose: () => void;
  onSaved?: (roleId: string) => void;
};

function RoleEditorContainerInner({ visible, onClose, onSaved }: Props) {
  const { permissions, createRole, loading } = useRoleManager();
  const { showAlert } = useAlert();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#6366f1');
  const [selectedPerms, setSelectedPerms] = useState<string[]>([]);

  const categories = useMemo(
    () => Array.from(new Set(permissions.map((p) => p.category))),
    [permissions],
  );

  // Resolve a template's permission keys against the live permission set;
  // unknown keys are silently skipped. Mirrors RoleBuilder.handlePickTemplate.
  const handleApplyTemplate = (tpl: RoleTemplate) => {
    const ids = permissions.filter((p) => tpl.permissionKeys.includes(p.key)).map((p) => p.id);
    setName(tpl.name);
    setDescription(tpl.description);
    setColor(tpl.color);
    setSelectedPerms(ids);
  };

  const handleSave = async () => {
    if (!name.trim()) return showAlert('Error', 'Role name is required.');
    const id = await createRole(name, description, color, selectedPerms);
    // createRole errorToasts on failure and returns null; on success it has
    // already refreshed the manager data.
    if (id) {
      onSaved?.(id);
      onClose();
    }
  };

  return (
    <RoleEditorSheet
      visible={visible}
      onClose={onClose}
      isCreating
      editingRole={null}
      name={name}
      onChangeName={setName}
      description={description}
      onChangeDescription={setDescription}
      color={color}
      onChangeColor={setColor}
      selectedPerms={selectedPerms}
      onTogglePerm={(id) =>
        setSelectedPerms((prev) =>
          prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
        )
      }
      permissions={permissions}
      categories={categories}
      isGlobal={undefined}
      canEdit
      onSave={handleSave}
      loading={loading}
      onBulkToggle={(ids, select) =>
        setSelectedPerms((prev) =>
          select ? Array.from(new Set([...prev, ...ids])) : prev.filter((p) => !ids.includes(p)),
        )
      }
      onApplyTemplate={handleApplyTemplate}
    />
  );
}

export default function RoleEditorContainer(props: Props) {
  return (
    <RoleManagerProvider>
      <RoleEditorContainerInner {...props} />
    </RoleManagerProvider>
  );
}
