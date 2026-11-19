--
-- PostgreSQL database cluster dump
--

\restrict ihW4n1sk6N4J4Wqw92fK2wGahUIGSaukdv2ETriac0S2uOVaidleMimdddrQieN

SET default_transaction_read_only = off;

SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;

--
-- Roles
--

CREATE ROLE phub_cup_level_fixture;
ALTER ROLE phub_cup_level_fixture WITH NOSUPERUSER INHERIT NOCREATEROLE NOCREATEDB LOGIN NOREPLICATION NOBYPASSRLS;
ALTER ROLE postgres WITH SUPERUSER INHERIT CREATEROLE CREATEDB LOGIN REPLICATION BYPASSRLS;

--
-- User Configurations
--






\unrestrict ihW4n1sk6N4J4Wqw92fK2wGahUIGSaukdv2ETriac0S2uOVaidleMimdddrQieN

--
-- PostgreSQL database cluster dump complete
--
