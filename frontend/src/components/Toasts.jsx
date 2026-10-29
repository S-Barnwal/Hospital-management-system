import { ToastContainer } from 'react-toastify';

/** Single toast host, styled to match the brand. */
export default function Toasts() {
  return (
    <ToastContainer
      newestOnTop
      theme="light"
      limit={4}
      toastClassName="!rounded-xl !font-sans !text-sm !text-ink !shadow-[var(--shadow-lift)]"
      progressClassName="!bg-gold-500"
    />
  );
}
