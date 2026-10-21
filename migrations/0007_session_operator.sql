-- 共用帳號時記錄「是誰在操作」：每次登入填寫自己的名字，記在這次登入的 session 上
ALTER TABLE sessions ADD COLUMN operator TEXT;
