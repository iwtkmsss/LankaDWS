import { ArrowLeft, House, RefreshCw, SearchX, ShieldX, TriangleAlert, WifiOff, Wrench } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { BrandMark, Button } from '../shared/ui'

export default function ErrorPage({ status }: { status: 403 | 404 | 500 | 'offline' | 'conflict' | 'maintenance' }) {
  const navigate = useNavigate()
  const config =
    status === 403
      ? {
          title: 'У вас немає доступу',
          text: 'Цей розділ або запис недоступний для вашої ролі та company scope.',
          icon: ShieldX,
        }
      : status === 404
        ? {
            title: 'Такої сторінки немає',
            text: 'Посилання могло змінитися або об’єкт уже недоступний.',
            icon: SearchX,
          }
        : status === 'offline'
          ? {
              title: 'Немає з’єднання',
              text: 'Перевірте мережу. Незбережені дані у формі залишаться в цьому вікні.',
              icon: WifiOff,
            }
          : status === 'conflict'
            ? {
                title: 'Дані вже змінилися',
                text: 'Оновіть запис і повторіть дію, щоб не перезаписати зміни колеги.',
                icon: TriangleAlert,
              }
            : status === 'maintenance'
              ? {
                  title: 'Триває технічне обслуговування',
                  text: 'LankaDWS тимчасово не приймає зміни. Спробуйте ще раз за кілька хвилин.',
                  icon: Wrench,
                }
              : {
                  title: 'Щось пішло не так',
                  text: 'Ми не показуємо технічні деталі. Спробуйте ще раз або повідомте підтримці correlation ID.',
                  icon: RefreshCw,
                }
  const Icon = config.icon
  const retry = status === 500 || status === 'offline' || status === 'maintenance'
  return (
    <main className="error-page">
      <div className="error-brand">
        <BrandMark />
        <strong>LankaDWS</strong>
      </div>
      <section>
        <img src="/assets/errors/error-orbit.png" alt="" width="440" height="320" />
        <div>
          <Icon size={31} />
          <span className="eyebrow">{typeof status === 'string' ? status.toUpperCase() : `ПОМИЛКА ${status}`}</span>
          <h1>{config.title}</h1>
          <p>{config.text}</p>
          <div className="button-row">
            <Link className="button button--primary" to="/feed">
              <House size={17} />
              До стрічки
            </Link>
            {status !== 403 && (
              <Button variant="secondary" onClick={() => (retry ? location.reload() : navigate(-1))}>
                {retry ? <RefreshCw size={17} /> : <ArrowLeft size={17} />}
                {retry ? 'Спробувати ще' : 'Назад'}
              </Button>
            )}
          </div>
        </div>
      </section>
    </main>
  )
}
