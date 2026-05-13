# Mac Home Server + Cloudflare Tunnel

이 문서는 StampWS를 Firebase가 아니라 M1 MacBook에서 직접 실행하고, Cloudflare Tunnel로 `stampws.kr` 도메인에 연결하는 운영 절차다.

## 구조

```txt
사용자 브라우저
  -> https://stampws.kr
  -> Cloudflare Tunnel
  -> MacBook Docker
  -> Next.js web:3000
  -> PostgreSQL
```

외부에는 MacBook의 포트를 직접 열지 않는다. Cloudflare Tunnel만 밖으로 연결한다.

## 1. MacBook 준비

1. 전원 연결 유지
2. 시스템 설정에서 절전 해제
3. 가능하면 유선 LAN 사용
4. Docker Desktop 설치
5. Cloudflare 계정에 `stampws.kr` 등록

## 2. 환경변수 생성

`.env.localserver.example`을 복사해서 `.env`를 만든다.

```bash
cp .env.localserver.example .env
```

랜덤 secret 생성 예시:

```bash
openssl rand -base64 48
```

필수 값:

```txt
APP_SECRET
POSTGRES_PASSWORD
LOCAL_SUPERADMIN_PASSWORD
CLOUDFLARE_TUNNEL_TOKEN
```

## 3. Cloudflare Tunnel 만들기

Cloudflare Zero Trust에서:

```txt
Networks
-> Tunnels
-> Create a tunnel
-> Docker 선택
-> token 복사
```

Public hostname:

```txt
Hostname: stampws.kr
Service: http://web:3000
```

복사한 token을 `.env`의 `CLOUDFLARE_TUNNEL_TOKEN`에 넣는다.

## 4. 서버 실행

```bash
npm run local:server
```

확인:

```bash
docker compose ps
```

로컬 테스트:

```txt
http://127.0.0.1:3000
```

외부 테스트:

```txt
https://stampws.kr
```

## 5. 초기 관리자

초기 계정:

```txt
ID: superadmin
PW: .env의 LOCAL_SUPERADMIN_PASSWORD
```

첫 로그인 후 비밀번호를 행사 운영용으로 따로 관리한다.

## 6. 행사 당일 운영 체크

시작 전:

```bash
docker compose ps
docker compose logs --tail=100 web
docker compose logs --tail=100 tunnel
```

장애 시 재시작:

```bash
docker compose restart web
```

전체 재시작:

```bash
docker compose restart
```

## 7. 보안 원칙

- 공유기 포트포워딩 사용 금지
- `.env` GitHub 업로드 금지
- Cloudflare Tunnel token 공개 금지
- MacBook 절전 금지
- 행사 전날 부하 테스트 필수
- `storage/`와 PostgreSQL 볼륨 백업 필수

## 8. 백업

DB 백업:

```bash
docker compose exec db pg_dump -U stampws stampws > backups/stampws-$(date +%Y%m%d-%H%M).sql
```

업로드 파일 백업:

```bash
tar -czf backups/storage-$(date +%Y%m%d-%H%M).tar.gz storage
```
