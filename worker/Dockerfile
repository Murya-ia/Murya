# Image du worker, pour le faire tourner ailleurs que sur GitHub Actions (Railway, Fly.io…)
# sans rien changer au code. Les secrets sont passés en variables d'environnement.
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY murya_worker ./murya_worker
CMD ["python", "-m", "murya_worker", "--max-minutes", "12"]
