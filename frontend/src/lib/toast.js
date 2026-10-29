// Toast notifications (react-toastify v11 injects its own CSS).
import { toast } from 'react-toastify';

const base = { position: 'top-right', autoClose: 3500, pauseOnHover: true, closeOnClick: true };

export const notify = {
  success: (msg) => toast.success(msg, base),
  error: (msg) => toast.error(msg, { ...base, autoClose: 6000 }),
  info: (msg) => toast.info(msg, base),
  warning: (msg) => toast.warning(msg, base),
};

/** Runs an async action and shows a success or error toast. Returns true on success. */
export async function withToast(fn, successMessage) {
  try {
    const result = await fn();
    if (successMessage) notify.success(successMessage);
    return result ?? true;
  } catch (err) {
    notify.error(err?.message || 'Something went wrong.');
    return false;
  }
}
