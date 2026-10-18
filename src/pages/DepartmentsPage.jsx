import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./modules.css";
import "./invoices-ledger.css";
import "./settings-pages.css";
import "./roles-users.css";
import SettingsHeader, { COMPANY_TABS } from "../components/SettingsHeader";
import DepartmentsTab from "../components/DepartmentsTab";
import { useCurrentUser } from "../state/CurrentUserContext";
import { usePeople } from "../state/PeopleContext";

// Settings → Company → Departments. How the company is organised:
// each department is its own record mapped to a value of the Department
// dimension (as Ramp maps a department to an ERP value). People are put in a
// department on Users & Roles. Managed by whoever manages users.

export default function DepartmentsPage() {
  const { users, departments, saveDepartment, deleteDepartment } = usePeople();
  const { hasCapability } = useCurrentUser();
  const canManage = hasCapability("users.manage");
  const navigate = useNavigate();
  const [editing, setEditing] = useState(null); // null | "new" | department
  const [toast, setToast] = useState("");
  const toastTmr = useRef(null);

  function showToast(msg) {
    setToast(msg);
    clearTimeout(toastTmr.current);
    toastTmr.current = setTimeout(() => setToast(""), 2200);
  }

  function onSave(dept) {
    saveDepartment(dept);
    showToast(dept.id ? `Department ${dept.name} saved.` : `Department ${dept.name} created.`);
    setEditing(null);
  }

  function onDelete(dept) {
    if (users.some((u) => u.status !== "Inactive" && u.department === dept.name)) return;
    deleteDepartment(dept);
    showToast(`Department ${dept.name} deleted.`);
  }

  return (
    <div className="lg-page users-page">
      <div className="lg-scroll-container">
        <SettingsHeader
          title="Company"
          tabs={COMPANY_TABS}
          intro="Where people sit in the organisation. Each department maps to a value of the Department dimension used in accounting; put people in a department on Users & Roles."
          actions={canManage && (
            <button type="button" className="lg-btn-brand" onClick={() => setEditing("new")}>
              <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              Create department
            </button>
          )}
        />
        <DepartmentsTab
          departments={departments}
          users={users}
          canManage={canManage}
          editing={editing}
          setEditing={setEditing}
          onSave={onSave}
          onDelete={onDelete}
          onShowPeople={(name) => navigate(`/users?dept=${encodeURIComponent(name)}`)}
        />
      </div>
      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
