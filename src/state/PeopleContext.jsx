import { createContext, useContext, useMemo, useState } from "react";
import { USERS as SEED_USERS } from "../data/seed/roles";

// People: the user list (Settings → Users & Roles), shared so edits survive
// moving between the Users and Roles tabs.

const PeopleContext = createContext(null);

export function PeopleProvider({ children }) {
  const [users, setUsers] = useState(() => SEED_USERS.map((u) => ({ ...u, roleKeys: [...u.roleKeys] })));
  const value = useMemo(() => ({ users, setUsers }), [users]);
  return <PeopleContext.Provider value={value}>{children}</PeopleContext.Provider>;
}

export function usePeople() {
  const ctx = useContext(PeopleContext);
  if (!ctx) throw new Error("usePeople must be used within PeopleProvider");
  return ctx;
}
