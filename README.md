# Serverless Swagger Endpoints Plugin

**This plugin is very much work in progress - please come back later.**

This plugin acts as a drop-in replacement for normal endpoints. It may be used
in cases where the project either has a ready-made Swagger documentation or
just wants to use the Swagger definition as the master data for endpoints.

AWS API Gateway implements Swagger importing functionality, with the possibility
to bind to Lambdas etc. As Serverless does not support much documentation for the
endpoints, it is better that the Swagger definition drives Serverless endpoints
than vice versa.

What already works:

   * Importing of the whole API into API Gateway
   * Importing of models

TODO:

   * Support importing models or (individual) endpoints only
   * Support Serverless endpoint definitions instead of Swagger extensions
   * Tests
   * Examples (simple & complex)


