import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { USERS as SEED_USERS } from "../data/seed/roles";
import { DIM_BY_KEY } from "../data/seed/dimensions";

// People: the user list (Settings → Users & Roles) and the departments they sit
// in (Settings → Company → Departments). Shared because the two pages
// edit each other — renaming a department moves its people with it, and the
// department list counts people — and so edits survive moving between tabs.
//
// Departments follow Ramp: each is its own record mapped to a value of the
// Department dimension. The demo starts with one department per seeded
// Department value, mapped to itself.

const PeopleContext = createContext(null);

function seedDepartments() {
  return (DIM_BY_KEY.dept?.values || [])
    .filter((v) => v !== "—")
    .map((v, i) => ({ id: `D${String(i + 1).padStart(2, "0")}`, name: v, dimValue: v }));
}

export function PeopleProvider({ children }) {
  const [users, setUsers] = useState(() => SEED_USERS.map((u) => ({ ...u, roleKeys: [...u.roleKeys] })));
  const [departments, setDepartments] = useState(seedDepartments);

  // Create (no id) or update a department. A rename carries its people along.
  const saveDepartment = useCallback(({ id, name, dimValue }) => {
    if (!id) {
      setDepartments((cur) => [...cur, { id: `D${String(Date.now()).slice(-6)}`, name, dimValue }]);
      return;
    }
    setDepartments((cur) => {
      const old = cur.find((d) => d.id === id);
      if (old && old.name !== name) {
        setUsers((us) => us.map((u) => (u.department === old.name ? { ...u, department: name } : u)));
      }
      return cur.map((d) => (d.id === id ? { ...d, name, dimValue } : d));
    });
  }, []);

  // Only when no active or invited person is in it; inactive accounts that
  // still name it simply lose the department.
  const deleteDepartment = useCallback((dept) => {
    setDepartments((cur) => cur.filter((d) => d.id !== dept.id));
    setUsers((us) => us.map((u) => (u.department === dept.name ? { ...u, department: null } : u)));
  }, []);

  const value = useMemo(
    () => ({ users, setUsers, departments, saveDepartment, deleteDepartment }),
    [users, departments, saveDepartment, deleteDepartment],
  );
  return <PeopleContext.Provider value={value}>{children}</PeopleContext.Provider>;
}

export function usePeople() {
  const ctx = useContext(PeopleContext);
  if (!ctx) throw new Error("usePeople must be used within PeopleProvider");
  return ctx;
}
